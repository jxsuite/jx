---
spec: server.md
level: minor
---

§3.4 the live preview origin runs one component or one layout on its own at /**jx_live**/harness/<project path>, composed as a page is, with a component's test props read from a bounded, plain-data props query parameter and unset props named on the page. A retarget is taken as a reload only when path and query both match the tab's address, so changed or cleared test props reach a tab already on that component. Test props are applied only to an address carrying a key the origin mints per instance and adds itself, in a retarget's event or by redirecting the first request for the address its opener asked for; any other address with props renders the declared defaults and says so. The reload stream and the harness refuse a request whose Host is not loopback, so a rebound name cannot read the key.
