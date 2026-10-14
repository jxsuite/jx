/**
 * Actions.test.ts — the AuthActions handlers under a real (happy-dom) DOM: FormData is read from
 * the enclosing form, the injected client receives the mapped calls, successes refresh the session
 * store / bump scope._v / apply redirects, and failures leave everything untouched.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ActionScope } from "@jxsuite/connector/table-actions";
import type { AuthSessionResult, JxAuthClient, SocialSignInInput } from "../src/client";

GlobalRegistrator.register();

const { setAuthClient } = await import("../src/client");
const { currentSession, resetSessionStore } = await import("../src/session");
const { AuthActions } = await import("../src/actions");

const { afterEach, describe, expect, spyOn, test } = await import("bun:test");

type EmailSignInInput = Parameters<JxAuthClient["signIn"]["email"]>[0];
type EmailSignUpInput = Parameters<JxAuthClient["signUp"]["email"]>[0];

interface Call {
  method: string;
  input: EmailSignInInput | EmailSignUpInput | SocialSignInInput | undefined;
}

/** A recording client: every method resolves to the queued result (default success). */
function fakeClient(results: Partial<Record<string, { error?: { message: string } }>> = {}) {
  const calls: Call[] = [];
  const respond = (method: string, input?: Call["input"]): Promise<AuthSessionResult> => {
    calls.push({ input, method });
    return Promise.resolve(results[method] ?? { data: { user: { id: "u1", role: "writer" } } });
  };
  const client = {
    calls,
    getSession: () => respond("getSession"),
    signIn: {
      email: (input: EmailSignInInput) => respond("signIn.email", input),
      social: (input: SocialSignInInput) => respond("signIn.social", input),
    },
    signOut: () => respond("signOut"),
    signUp: { email: (input: EmailSignUpInput) => respond("signUp.email", input) },
  } satisfies JxAuthClient & { calls: Call[] };
  setAuthClient(client);
  return client;
}

/** A real form with the given string fields, plus a submit event dispatched on it. */
function formEvent(fields: Record<string, string>): Event {
  const form = document.createElement("form");
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  // Dispatching sets `event.target` to the form; nothing listens, so nothing submits.
  const event = new Event("submit", { cancelable: true });
  form.dispatchEvent(event);
  return event;
}

afterEach(() => {
  setAuthClient(null);
  resetSessionStore();
  document.body.innerHTML = "";
});

describe("AuthActions", () => {
  test("signInEmail reads the form, refreshes the session, and bumps scope._v", async () => {
    const client = fakeClient();
    const actions = new AuthActions().resolve();
    const scope: ActionScope = {};

    const ok = await actions.signInEmail(
      scope,
      formEvent({ email: "kevin@example.com", password: "pw12345678" }),
    );
    expect(ok).toBe(true);
    expect(client.calls[0]).toEqual({
      input: { email: "kevin@example.com", password: "pw12345678" },
      method: "signIn.email",
    });
    expect(client.calls[1]?.method).toBe("getSession");
    expect(currentSession()).toMatchObject({ role: "writer", userId: "u1" });
    expect(scope._v).toBe(1);
  });

  test("signUpEmail defaults the name to the email's local part", async () => {
    const client = fakeClient();
    const actions = new AuthActions().resolve();

    await actions.signUpEmail({}, formEvent({ email: "ada@example.com", password: "pw" }));
    expect(client.calls[0]).toEqual({
      input: { email: "ada@example.com", name: "ada", password: "pw" },
      method: "signUp.email",
    });

    await actions.signUpEmail(
      {},
      formEvent({ email: "ada@example.com", name: "Ada", password: "pw" }),
    );
    expect(client.calls.at(-2)).toEqual({
      input: { email: "ada@example.com", name: "Ada", password: "pw" },
      method: "signUp.email",
    });
  });

  test("signInSocial uses the form/def provider and the afterSignIn callback", async () => {
    const client = fakeClient();
    const actions = new AuthActions({
      provider: "github",
      redirects: { afterSignIn: "/app" },
    }).resolve();

    await actions.signInSocial({}, formEvent({}));
    expect(client.calls[0]).toEqual({
      input: { callbackURL: "/app", provider: "github" },
      method: "signIn.social",
    });

    await actions.signInSocial({}, formEvent({ provider: "google" }));
    expect(client.calls.at(-2)?.input).toMatchObject({ provider: "google" });
  });

  test("signOut clears the session, bumps scope._v, and redirects", async () => {
    const client = fakeClient();
    const assign = spyOn(location, "assign").mockImplementation(() => null);
    try {
      const actions = new AuthActions({ redirects: { afterSignOut: "/bye" } }).resolve();
      const scope: ActionScope = { _v: 4 };

      const ok = await actions.signOut(scope, formEvent({}));
      expect(ok).toBe(true);
      expect(client.calls.map((c) => c.method)).toEqual(["signOut"]);
      expect(currentSession()).toBeNull();
      expect(scope._v).toBe(5);
      expect(assign).toHaveBeenCalledWith("/bye");
    } finally {
      assign.mockRestore();
    }
  });

  test("failures return false and change nothing", async () => {
    const client = fakeClient({
      "signIn.email": { error: { message: "bad credentials" } },
      signOut: { error: { message: "nope" } },
    });
    const actions = new AuthActions().resolve();
    const scope: ActionScope = {};

    expect(await actions.signInEmail(scope, formEvent({ email: "x", password: "y" }))).toBe(false);
    expect(await actions.signOut(scope)).toBe(false);
    expect(scope._v).toBeUndefined();
    expect(currentSession()).toBeNull();
    // Only the failing calls went out — no session refresh afterwards.
    expect(client.calls.map((c) => c.method)).toEqual(["signIn.email", "signOut"]);
  });

  test("a control's event reads its owner form; a formless target reads nothing", async () => {
    const client = fakeClient();
    const actions = new AuthActions().resolve();

    const form = document.createElement("form");
    const email = document.createElement("input");
    email.name = "email";
    email.value = "ada@example.com";
    const submit = document.createElement("button");
    form.append(email, submit);
    document.body.append(form);
    const click = new Event("click", { cancelable: true });
    submit.dispatchEvent(click);
    await actions.signInEmail({}, click);

    const loose = document.createElement("div");
    document.body.append(loose);
    const stray = new Event("click", { cancelable: true });
    loose.dispatchEvent(stray);
    await actions.signInEmail({}, stray);

    expect(client.calls.filter((c) => c.method === "signIn.email")).toEqual([
      { input: { email: "ada@example.com", password: "" }, method: "signIn.email" },
      { input: { email: "", password: "" }, method: "signIn.email" },
    ]);
  });

  test("redirects fall back to _project.auth.redirects; no event means empty values", async () => {
    const client = fakeClient();
    const assign = spyOn(location, "assign").mockImplementation(() => null);
    try {
      const actions = new AuthActions({
        _project: { auth: { redirects: { afterSignIn: "/from-project" } } },
      });
      expect(actions.redirects()).toEqual({ afterSignIn: "/from-project" });

      const ok = await actions.resolve().signInEmail({});
      expect(ok).toBe(true);
      expect(client.calls[0]?.input).toEqual({ email: "", password: "" });
      expect(assign).toHaveBeenCalledWith("/from-project");
    } finally {
      assign.mockRestore();
    }
  });
});
