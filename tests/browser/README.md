# Desktop browser regressions

Install the project dependencies and a browser once:

```sh
npm install
npx playwright install chromium
```

Run the desktop tests separately from the Node unit tests:

```sh
npx playwright test --config playwright.desktop.config.ts
```

To use an existing Chrome/Chromium installation, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path.

The local fixture renders the production Desktop, Window and app components with
the production Tailwind stylesheet. Authentication is a fixed test user; project
API requests are intercepted with views produced by the real scenario runtime
and offline evaluator. No Supabase account, database or model service is used.

The tests check minimising/restoring Notes, Cody and Meet on desktop and compact
viewports without unmounting or losing their editable drafts, hidden-window focus
behaviour, and computed Notes text/placeholder contrast and caret color. The Notes
test saves a restored-window screenshot and contrast measurements in its output
directory. They test the current page lifecycle;
closing a window, refreshing and signing out are outside this persistence scope.

For a regression check against an earlier Git revision, set
`DESKTOP_FIXTURE_BASELINE` to that revision. The fixture reads the earlier
Desktop, Window and Notes sources during its build without changing the checkout.
Failures keep a Playwright trace under `test-results/`.
