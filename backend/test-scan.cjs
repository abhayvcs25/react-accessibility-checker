const ac = require("accessibility-checker");

(async () => {
  try {
    const html = [
      "<!DOCTYPE html>",
      "<html><head><title>Test</title></head>",
      "<body>",
      '<img src="test.jpg">',
      "</body></html>"
    ].join("\n");

    const result = await ac.getCompliance(html, "test-scan-" + Date.now());
    const report = result.report;

    console.log("Top-level keys:", Object.keys(report));
    console.log("numExecuted:", report.numExecuted);
    console.log("results count:", report.results.length);

    const nonPass = report.results.filter(r => r.value[1] !== "PASS");
    console.log("Non-pass results:", nonPass.length);

    if (nonPass.length > 0) {
      console.log("First non-pass item keys:", Object.keys(nonPass[0]));
      console.log("First non-pass item:", JSON.stringify(nonPass[0], null, 2));
    }

    // Also show a pass item for comparison
    const passItems = report.results.filter(r => r.value[1] === "PASS");
    if (passItems.length > 0) {
      console.log("\nFirst pass item:", JSON.stringify(passItems[0], null, 2));
    }

    await ac.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
})();
