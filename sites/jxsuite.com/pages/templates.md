---
title: "Starter templates for Jx Studio"
$head:
  - tagName: meta
    attributes:
      name: description
      content: "Start a Jx project from a finished starter site: restaurants, shops, portfolios, SaaS landings and more. Pick one in Studio or clone it from the command line."
  - tagName: meta
    attributes:
      property: og:title
      content: "Jx Studio starter templates"
  - tagName: meta
    attributes:
      property: og:description
      content: "Thirteen finished starter sites, in plain JSON and Markdown you own."
  - tagName: meta
    attributes:
      property: og:type
      content: website
$elements:
  - $ref: ../components/cta-button.json
  - $ref: ../components/page-hero.json
  - $ref: ../components/site-section.json
  - $ref: ../components/starter-card.json
  - $ref: ../components/site-close.json
---

:::page-hero{props.heading="Thirteen starter sites for Jx Studio" props.lead="Each one is a finished site for a kind of business. Pick one in Studio's New Project dialog, or clone it from the command line. Every file is plain JSON and Markdown."}
::cta-button{props.href="https://studio.jxsuite.com/" props.label="Start a free trial" props.variant="primary"}

::cta-button{props.href="/download" props.label="Download Studio" props.variant="secondary"}
:::

:::::site-section{id="gallery" props.ground="alt" props.heading="Starters by kind of business" props.lead=""}
::::div{style.display="grid" style.gridTemplateColumns="repeat(auto-fill, minmax(min(320px, 100%), 1fr))" style.gap="1.5rem"}
::starter-card{props.name="Bistro & Café" props.industry="Restaurant & Food" props.tagline="A menu-driven site for a restaurant, café, or bakery." props.image="/starters/restaurant.jpg" props.accent="#b45309" props.slug="restaurant"}

::starter-card{props.name="Summit Heating & Cooling" props.industry="Home Services & Trades" props.tagline="Reliable HVAC repair and installation, backed by 24/7 service." props.image="/starters/home-services.jpg" props.accent="#ea580c" props.slug="home-services"}

::starter-card{props.name="Meridian Advisory" props.industry="Professional Services" props.tagline="Numbers that move the business forward." props.image="/starters/professional-firm.jpg" props.accent="#1e3a8a" props.slug="professional-firm"}

::starter-card{props.name="Northshore Realty" props.industry="Real Estate" props.tagline="Find your place on the north shore." props.image="/starters/real-estate.jpg" props.accent="#0e7490" props.slug="real-estate"}

::starter-card{props.name="Cadence Cycles" props.industry="Retail & Shop" props.tagline="Find your next favorite ride." props.image="/starters/shop.jpg" props.accent="#16a34a" props.slug="shop"}

::starter-card{props.name="Aperture Studio" props.industry="Creative & Portfolio" props.tagline="Light, patience, and a good eye." props.image="/starters/portfolio.jpg" props.accent="#d97706" props.slug="portfolio"}

::starter-card{props.name="Ember Yoga & Fitness" props.industry="Health & Wellness" props.tagline="Boutique yoga, pilates & strength for every body." props.image="/starters/fitness-studio.jpg" props.accent="#db2777" props.slug="fitness-studio"}

::starter-card{props.name="Craft & Code Academy" props.industry="Education & Courses" props.tagline="Become a web developer in 14 weeks." props.image="/starters/course.jpg" props.accent="#2563eb" props.slug="course"}

::starter-card{props.name="Horizon Conf 2026" props.industry="Events & Conferences" props.tagline="A landing site for a one-day tech and design conference." props.image="/starters/event.jpg" props.accent="#7c3aed" props.slug="event"}

::starter-card{props.name="Rivertown Foundation" props.industry="Nonprofit & Community" props.tagline="Neighbors helping neighbors across Rivertown." props.image="/starters/nonprofit.jpg" props.accent="#15803d" props.slug="nonprofit"}

::starter-card{props.name="The Long Field" props.industry="Blog & Publication" props.tagline="Slow essays on design, technology, and craft." props.image="/starters/blog.jpg" props.accent="#0ea5e9" props.slug="blog"}

::starter-card{props.name="Flowlark" props.industry="SaaS & Product" props.tagline="Plan, ship, and scale in one place." props.image="/starters/saas.jpg" props.accent="#6366f1" props.slug="saas"}

::starter-card{props.name="Atrium" props.industry="Museum & Culture" props.tagline="A city museum in three languages, from one set of pages." props.image="/starters/museum.jpg" props.accent="#2438c8" props.slug="museum"}
::::
:::::

::site-close{props.heading="Open a starter and make it yours" props.text="Choose one in the New Project dialog, then change the words, the pictures and the colors. Jx Cloud is free for 30 days and the desktop app is free."}
