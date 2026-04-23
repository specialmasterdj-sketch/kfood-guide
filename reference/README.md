# Shared Barcode Reference Sheets

This folder holds the per-vendor bar-code reference sheets that the
Invoice→Excel tool (`invoice-to-excel.html`) auto-loads on every computer.

## How to publish a new reference

1. Open `invoice-to-excel.html` on a computer that already has the reference
   loaded in the browser.
2. Pick the vendor, then click **⬇️ 공용 엑셀 내보내기**.
3. A file named `<vendor_id>.xlsx` downloads (e.g. `rhee_bros.xlsx`).
4. Drop that file into this folder, then commit + push. All other branches'
   computers pull it automatically on the next page load.

## Vendor IDs (used as filenames)

- `seoul_trading.xlsx`
- `rhee_bros.xlsx`
- `wismettac.xlsx`
- `jfc.xlsx`
- `wang_global.xlsx`
