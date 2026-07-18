# Sample data — Story 3.1 (Triangle upload)

Files for exercising the upload flow at `/triangles`. Story 3.1 only checks
**format-readability** (valid UTF-8 CSV / openable `.xlsx` workbook), not the
grid or actuarial content — that arrives with `engine_service /validate` in
Story 3.2. The triangle here is the classic **RAA / Taylor–Ashe** cumulative
paid-claims triangle (the golden-master dataset), laid out origin-year × 12-month
development columns with blanks in the lower-right (the unobserved future).

| File | Label | Expected outcome |
|------|-------|------------------|
| `raa-paid.csv` | paid | ✅ Created → one `pending_validation` row |
| `raa-paid.xlsx` | paid | ✅ Created (genuine workbook, passes the open gate) |
| `raa-incurred.csv` | incurred | ✅ Created (distinct numbers → no hash collision) |
| `raa-paid.csv` **again** | paid | ⚠️ Duplicate → "Identical triangle already exists (hash match)", no second copy stored |
| `bad-not-utf8.csv` | paid | ❌ Rejected — "File is not valid UTF-8 text." |
| `bad-not-a-workbook.xlsx` | paid | ❌ Rejected — "File is not a readable .xlsx workbook." |

Notes:
- **Duplicate detection is on raw bytes**, per Workspace. `raa-paid.csv` and
  `raa-paid.xlsx` hold the same numbers but are different files, so both upload.
  Re-uploading the *exact same* file is what triggers the duplicate path.
- `bad-not-a-workbook.xlsx` is plain text with an `.xlsx` name — it proves the
  gate is a real workbook-open, not just an extension check.
