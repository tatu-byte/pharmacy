// Browser regressions use the production Angular bundle and controlled API responses.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
let server, origin;
const medicine = {
  code: "MED0001",
  name: "Test Medicine",
  form: "tablet",
  strength_value: 500,
  strength_unit: "mg",
  is_active: true,
};
const rule = {
  id: 1,
  effective_from: "2020-01-01T22:00:00Z",
  effective_to: null,
  max_quantity_per_dispense: 10,
  max_quantity_per_30_days: 20,
  requires_authorisation: true,
};
const error = (message = "Try again") => ({
  error: {
    code: "request_rejected",
    violations: [{ code: "unavailable", field: "", message }],
  },
});
before(async () => {
  const root = path.resolve("dist/pharmacy/browser");
  server = http.createServer((req, res) => {
    const requested = path.resolve(root, "." + req.url.split("?")[0]);
    const file =
      requested.startsWith(root + path.sep) &&
      fs.existsSync(requested) &&
      fs.statSync(requested).isFile()
        ? requested
        : path.join(root, "index.html");
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  await new Promise((resolve) => server?.close(resolve));
});
async function setup(t, handler, init) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
    ],
  });
  const context = await browser.newContext();
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  t.after(async () => {
    await context.close();
    await browser.close();
    assert.deepEqual(browserErrors, []);
  });
  await page.route("**/api/v1/**", async (route) => {
    if (handler && (await handler(route, page))) return;
    const url = new URL(route.request().url());
    const data = url.pathname.endsWith("/rules")
      ? { data: [rule], next_cursor: null }
      : url.pathname.endsWith("/MED0001")
        ? { data: { ...medicine, current_rule: rule } }
        : url.pathname.endsWith("/dispenses")
          ? { data: [], next_cursor: null }
          : { data: [medicine], next_cursor: null };
    await route.fulfill({ json: data });
  });
  return page;
}
async function fill(page) {
  await page.goto(origin + "/capture");
  await page.locator("#medicine").fill("MED0001");
  await page.locator("#patient").fill("SYNTHETIC-TEST");
  await page.locator("#quantity").fill("2");
  await page.locator("#at").fill("2026-10-15T18:30:45");
}
const submit = (page) =>
  page.getByRole("button", { name: "Submit dispense", exact: true }).click();
async function recorded(route, id = 1) {
  const body = route.request().postDataJSON();
  await route.fulfill({ status: 201, json: { data: { id, ...body } } });
}

test("seconds are valid, Johannesburg conversion is correct, CSP renders styles", async (t) => {
  let body;
  const page = await setup(t, async (route) => {
    if (route.request().method() === "POST") {
      body = route.request().postDataJSON();
      await recorded(route);
      return true;
    }
  });
  await fill(page);
  await submit(page);
  await page.getByText("Dispense #1 recorded.").waitFor();
  assert.equal(body.dispensed_at, "2026-10-15T16:30:45.000Z");
  assert.equal(
    await page.evaluate(() =>
      sessionStorage.getItem("pharmacy.pending-dispense.v1"),
    ),
    null,
  );
  assert.equal(
    await page
      .locator("body")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgb(244, 247, 246)",
  );
});

test("lost response and refresh replay the exact payload and key", async (t) => {
  const bodies = [];
  const page = await setup(t, async (route) => {
    if (route.request().method() === "POST") {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) await route.abort("failed");
      else await recorded(route, 42);
      return true;
    }
  });
  await fill(page);
  await submit(page);
  await page.getByRole("button", { name: "Retry pending dispense" }).waitFor();
  assert.equal(await page.locator("#patient").isDisabled(), true);
  await page.reload();
  await page.getByRole("button", { name: "Retry pending dispense" }).click();
  await page.getByText("Dispense #42 recorded.").waitFor();
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(await page.locator("#patient").isDisabled(), true);
  await page.getByRole("button", { name: "New dispense", exact: true }).click();
  assert.equal(await page.locator("#patient").inputValue(), "");
});

test("server rejections show all fields and editing rotates the key", async (t) => {
  const bodies = [];
  const page = await setup(t, async (route) => {
    if (route.request().method() === "POST") {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 422,
        json: {
          error: {
            code: "request_rejected",
            violations: [
              {
                code: "per_dispense_limit",
                field: "quantity",
                message: "Single limit exceeded",
              },
              {
                code: "rolling_limit",
                field: "quantity",
                message: "Rolling limit exceeded",
              },
              {
                code: "authorisation_required",
                field: "authorisation_ref",
                message: "Reference required",
              },
            ],
          },
        },
      });
      return true;
    }
  });
  await fill(page);
  await submit(page);
  await page.getByText("Dispense not confirmed").waitFor();
  assert.equal(await page.locator(".error").count(), 3);
  await submit(page);
  await page.waitForFunction(
    () =>
      document.querySelector('button[type="submit"]').textContent.trim() ===
      "Submit dispense",
  );
  assert.equal(bodies[0].idempotency_key, bodies[1].idempotency_key);
  await page.locator("#quantity").fill("1");
  await submit(page);
  await page.waitForFunction(
    () =>
      document.querySelector('button[type="submit"]').textContent.trim() ===
      "Submit dispense",
  );
  assert.notEqual(bodies[1].idempotency_key, bodies[2].idempotency_key);
});

test("storage failure stops the request before it is sent", async (t) => {
  let posts = 0;
  const page = await setup(
    t,
    async (route) => {
      if (route.request().method() === "POST") {
        posts++;
        await recorded(route);
        return true;
      }
    },
    () => {
      Storage.prototype.setItem = () => {
        throw new Error("Storage disabled");
      };
    },
  );
  await fill(page);
  await submit(page);
  await page
    .getByText(
      "Request: Browser tab storage is unavailable. Enable it before submitting so retries remain safe.",
      { exact: true },
    )
    .waitFor();
  assert.equal(posts, 0);
});

test("whitespace references and fractional quantities cannot be submitted", async (t) => {
  const page = await setup(t);
  await fill(page);
  await page.locator("#patient").fill("   ");
  assert.equal(
    await page
      .getByRole("button", { name: "Submit dispense", exact: true })
      .isDisabled(),
    true,
  );
  await page.locator("#patient").fill("P");
  await page.locator("#quantity").fill("1.5");
  assert.equal(
    await page
      .getByRole("button", { name: "Submit dispense", exact: true })
      .isDisabled(),
    true,
  );
});

test("malformed server errors do not crash the error renderer", async (t) => {
  let calls = 0;
  const page = await setup(t, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 503,
        json:
          ++calls === 1
            ? { error: { violations: { bad: true } } }
            : {
                error: {
                  violations: [
                    {
                      code: "unknown",
                      field: "__proto__",
                      message: "Unknown field safely reported",
                    },
                  ],
                },
              },
      });
      return true;
    }
  });
  await fill(page);
  await submit(page);
  await page
    .getByText("Request failed (503). Try again to confirm the outcome.")
    .waitFor();
  await page.getByRole("button", { name: "Retry pending dispense" }).click();
  await page
    .getByText("Request: Unknown field safely reported", { exact: true })
    .waitFor();
  assert.equal(await page.getByRole("alert").getByRole("link").count(), 0);
});

test("failed Next preserves catalogue rows and retries the same cursor", async (t) => {
  let nextCalls = 0;
  const page = await setup(t, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/medicines")) {
      if (url.searchParams.has("cursor")) {
        nextCalls++;
        if (nextCalls === 1)
          await route.fulfill({ status: 503, json: error() });
        else
          await route.fulfill({
            json: {
              data: [{ ...medicine, code: "MED0002", name: "Second" }],
              next_cursor: null,
            },
          });
      } else
        await route.fulfill({
          json: { data: [medicine], next_cursor: "next" },
        });
      return true;
    }
  });
  await page.goto(origin + "/medicines");
  await page.getByText("Test Medicine", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Retry loading" }).waitFor();
  assert.equal(
    await page.getByText("Test Medicine", { exact: true }).count(),
    1,
  );
  await page
    .getByRole("button", { name: "Retry loading", exact: true })
    .click();
  await page.getByText("Second", { exact: true }).waitFor();
  assert.equal(nextCalls, 2);
});

test("failed ledger Next preserves rows and pagination position", async (t) => {
  let attempts = 0;
  const row = {
    id: 1,
    medicine_code: "MED0001",
    patient_ref: "P",
    quantity: 1,
    dispensed_at: "2026-10-15T10:00:00Z",
  };
  const page = await setup(t, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/dispenses")) {
      if (url.searchParams.has("cursor")) {
        attempts++;
        if (attempts === 1) await route.fulfill({ status: 503, json: error() });
        else
          await route.fulfill({
            json: { data: [{ ...row, id: 2 }], next_cursor: null },
          });
      } else
        await route.fulfill({ json: { data: [row], next_cursor: "next" } });
      return true;
    }
  });
  await page.goto(origin + "/ledger?patient=P");
  await page.getByText("#1", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Retry loading" }).waitFor();
  assert.equal(await page.getByText("#1", { exact: true }).count(), 1);
  await page
    .getByRole("button", { name: "Retry loading", exact: true })
    .click();
  await page.getByText("#2", { exact: true }).waitFor();
  assert.equal(attempts, 2);
});

test("failed initial rule history has a working retry", async (t) => {
  let attempts = 0;
  const page = await setup(t, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/rules")) {
      attempts++;
      if (attempts === 1) await route.fulfill({ status: 503, json: error() });
      else await route.fulfill({ json: { data: [rule], next_cursor: null } });
      return true;
    }
  });
  await page.goto(origin + "/medicines/MED0001");
  await page.getByRole("button", { name: "Retry rule history" }).click();
  await page.getByText("In force now", { exact: true }).waitFor();
  assert.equal(await page.locator(".timeline li").count(), 1);
});

test("catalogue names are rendered as text, not executable HTML", async (t) => {
  const name = '<img src=x onerror="window.compromised=true">';
  const page = await setup(t, async (route) => {
    await route.fulfill({
      json: { data: [{ ...medicine, name }], next_cursor: null },
    });
    return true;
  });
  await page.goto(origin + "/medicines");
  await page.getByText(name, { exact: true }).waitFor();
  assert.equal(await page.locator("main img").count(), 0);
  assert.equal(await page.evaluate(() => window.compromised), undefined);
});

test("medicine detail failure can retry without reloading the route", async (t) => {
  let calls = 0;
  const page = await setup(t, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/MED0001")) {
      calls++;
      if (calls === 1) await route.fulfill({ status: 503, json: error() });
      else
        await route.fulfill({
          json: { data: { ...medicine, current_rule: rule } },
        });
      return true;
    }
  });
  await page.goto(origin + "/medicines/MED0001");
  await page.getByRole("button", { name: "Retry medicine" }).click();
  await page.getByRole("heading", { name: "Test Medicine" }).waitFor();
  assert.equal(calls, 2);
  assert.equal(
    await page.getByRole("button", { name: "Retry medicine" }).count(),
    0,
  );
});

test("empty search can reset filters and return to the catalogue", async (t) => {
  const page = await setup(t, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/medicines") && url.searchParams.get("q")) {
      await route.fulfill({ json: { data: [], next_cursor: null } });
      return true;
    }
  });
  await page.goto(origin + "/medicines");
  await page.getByLabel("Name or code", { exact: true }).fill("missing");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("heading", { name: "No matching medicines" }).waitFor();
  await page.getByRole("button", { name: "Show all medicines" }).click();
  await page.getByText("Test Medicine", { exact: true }).waitFor();
  assert.equal(await page.locator("#query").inputValue(), "");
});

test("validation explains disabled submission and server feedback receives focus", async (t) => {
  const page = await setup(t, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 422,
        json: {
          error: {
            code: "request_rejected",
            violations: [
              {
                code: "rolling_limit",
                field: "quantity",
                message: "Rolling limit exceeded",
              },
            ],
          },
        },
      });
      return true;
    }
  });
  await fill(page);
  await page.locator("#quantity").fill("1.5");
  await page.locator("#at").focus();
  await page
    .getByText("Enter a whole number between 1 and 2,147,483,647.")
    .waitFor();
  assert.equal(
    await page.locator("#quantity").getAttribute("aria-invalid"),
    "true",
  );
  await page.locator("#quantity").fill("2");
  await submit(page);
  await page.waitForFunction(() =>
    document.activeElement?.hasAttribute("data-feedback"),
  );
  assert.equal(
    await page.locator("#quantity").getAttribute("aria-invalid"),
    "true",
  );
  await page
    .getByRole("link", { name: "Quantity: Rolling limit exceeded" })
    .click();
  assert.equal(page.url(), origin + "/capture");
  assert.equal(
    await page
      .locator("#quantity")
      .evaluate((e) => document.activeElement === e),
    true,
  );
});

test("all four views fit a narrow viewport with usable local table scrolling", async (t) => {
  const page = await setup(t, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/dispenses")) {
      await route.fulfill({
        json: {
          data: [
            {
              id: 1,
              medicine_code: "MED0001",
              patient_ref: "P",
              quantity: 1,
              dispensed_at: "2026-10-15T10:00:00Z",
            },
          ],
          next_cursor: null,
        },
      });
      return true;
    }
  });
  await page.setViewportSize({ width: 360, height: 800 });
  for (const route of [
    "/medicines",
    "/medicines/MED0001",
    "/capture",
    "/ledger?patient=P",
  ]) {
    await page.goto(origin + route);
    await page.locator("h1").waitFor();
    await page.waitForFunction(() => !document.querySelector(".loading"));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      route + " should not overflow the viewport",
    );
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    assert.equal(await nav.locator('[aria-current="page"]').count(), 1);
    if (await page.locator(".table-wrap").count())
      assert.equal(
        await page
          .locator(".table-wrap")
          .evaluate((e) => e.scrollWidth > e.clientWidth),
        true,
      );
  }
});

test("historical display uses the named timezone rather than a fixed modern offset", async (t) => {
  const stamp = "1900-01-01T00:00:00Z";
  const page = await setup(t, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/dispenses")) {
      await route.fulfill({
        json: {
          data: [
            {
              id: 1,
              medicine_code: "MED0001",
              patient_ref: "P",
              quantity: 1,
              dispensed_at: stamp,
            },
          ],
          next_cursor: null,
        },
      });
      return true;
    }
  });
  await page.goto(origin + "/ledger?patient=P");
  await page.getByText("#1", { exact: true }).waitFor();
  const text = await page.locator("tbody tr td").first().textContent();
  // Johannesburg was UTC+01:30 in 1900, not the present-day UTC+02:00.
  assert.match(text, /01:30:00/);
});

test("keyboard skip link moves focus to the content region", async (t) => {
  const page = await setup(t);
  await page.goto(origin + "/medicines");
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .getByRole("link", { name: "Skip to content" })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  assert.equal(page.url(), origin + "/medicines");
  assert.equal(
    await page.locator("#main").evaluate((e) => e === document.activeElement),
    true,
  );
});
