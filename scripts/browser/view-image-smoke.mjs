import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launch } from "./cdp.mjs";

const url = process.argv[2];
assert(
  url,
  "Usage: node scripts/browser/view-image-smoke.mjs <conversation URL>",
);
const { page, close } = await launch();
const selector = 'img[src*="/files?path="]';

try {
  await page.goto(url);
  await page.waitFor(
    `document.querySelector(${JSON.stringify(selector)})?.naturalWidth > 0`,
    { timeoutMs: 30000 },
  );
  const images =
    await page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}), image => ({
    src: image.src, width: image.naturalWidth, height: image.naturalHeight,
    href: image.closest('a')?.href, target: image.closest('a')?.target
  }))`);
  assert(images.length > 0);
  for (const image of images) {
    assert(image.width > 0 && image.height > 0, "Image failed to decode");
    assert.equal(image.href, image.src);
    assert.equal(image.target, "_blank");
  }
  assert.deepEqual(page.errors, []);
  await page.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`,
  );
  const inline = join(tmpdir(), "hivedeck-view-image-inline.png");
  await page.screenshot(inline);
  const imageResponse = await fetch(images[0].href);
  assert.equal(imageResponse.status, 200);
  assert(imageResponse.headers.get("content-type").startsWith("image/"));
  assert.equal(imageResponse.headers.get("x-content-type-options"), "nosniff");
  for (const path of ["../secret.png", "/tmp/../secret.png", "/etc/hosts"]) {
    const denied = new URL(images[0].src);
    denied.searchParams.set("path", path);
    assert.equal((await fetch(denied)).status, 403, path);
  }
  console.log(
    `Inline: ${images.length} decoded images; open links: 200; traversal/non-image: 403; console: clean. ${inline}`,
  );

  page.on("Fetch.requestPaused", ({ requestId }) => {
    void page.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: 404,
      body: "",
    });
  });
  await page.send("Fetch.enable", {
    patterns: [{ urlPattern: "*/files?path=*", requestStage: "Request" }],
  });
  await page.goto(url);
  await page.waitFor(
    `document.querySelector('a[href*="/files?path="]')?.parentElement.classList.contains('text-destructive')`,
    { timeoutMs: 30000 },
  );
  const fallback = await page.evaluate(`(() => {
    const link = document.querySelector('a[href*="/files?path="]');
    link.scrollIntoView({block:'center'});
    return {text:link.parentElement.innerText, href:link.href, target:link.target, images:document.querySelectorAll(${JSON.stringify(selector)}).length};
  })()`);
  assert.equal(fallback.images, 0);
  assert.equal(fallback.target, "_blank");
  assert(fallback.href.includes("/files?path="));
  const failed = join(tmpdir(), "hivedeck-view-image-fallback.png");
  await page.screenshot(failed);
  console.log(`404 fallback: ${fallback.text}. ${failed}`);
} finally {
  await close();
}
