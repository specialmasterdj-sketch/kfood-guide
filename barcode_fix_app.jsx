import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

/* ---------- design tokens ----------
   bg:        #12161C  (near-black slate)
   surface:   #1B212A
   surface-2: #232B36
   line:      #2B3440
   text:      #F2EFEA
   text-mute: #8B93A1
   amber:     #F2A93B  (scan-line gold — signature accent)
   mint:      #34D399  (verified)
   red:       #F2645A  (error/flag)
   mono font: ui-monospace stack (barcode digits)
   display:   -apple-system tight tracking
------------------------------------- */

const COLORS = {
  bg: "#12161C",
  surface: "#1B212A",
  surface2: "#232B36",
  line: "#2B3440",
  text: "#F2EFEA",
  mute: "#8B93A1",
  amber: "#F2A93B",
  mint: "#34D399",
  red: "#F2645A",
};

const MONO =
  '"SF Mono", ui-monospace, "Cascadia Code", Menlo, Consolas, monospace';
const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const STORAGE_KEY = "barcode-checklist-items";

/* ---------- check digit math ---------- */
function onlyDigits(v) {
  return (v ?? "").toString().replace(/\D/g, "");
}

function upcaCheckDigit(d11) {
  let odd = 0,
    even = 0;
  for (let i = 0; i < 11; i++) {
    const n = parseInt(d11[i], 10);
    if ((i + 1) % 2 === 1) odd += n;
    else even += n;
  }
  return (10 - ((odd * 3 + even) % 10)) % 10;
}

function ean13CheckDigit(d12) {
  let odd = 0,
    even = 0;
  for (let i = 0; i < 12; i++) {
    const n = parseInt(d12[i], 10);
    if ((i + 1) % 2 === 1) odd += n;
    else even += n;
  }
  return (10 - (odd + even * 3) % 10) % 10;
}

// Resolve a raw (possibly truncated) barcode into a full one.
function resolveBarcode(raw) {
  const digits = onlyDigits(raw);
  const len = digits.length;

  if (len === 11) {
    const cd = upcaCheckDigit(digits);
    return {
      type: "UPC-A",
      status: "계산됨",
      full: digits + cd,
      note: "11자리 → 체크디지트 계산",
    };
  }

  if (len === 12) {
    // Could already be a complete UPC-A, or an EAN-13 prefix missing its digit.
    const asUpcaCheck = upcaCheckDigit(digits.slice(0, 11));
    if (asUpcaCheck === parseInt(digits[11], 10)) {
      return {
        type: "UPC-A",
        status: "이미 완성",
        full: digits,
        note: "12자리 그대로 유효한 UPC-A",
      };
    }
    const cd = ean13CheckDigit(digits);
    return {
      type: "EAN-13",
      status: "계산됨",
      full: digits + cd,
      note: "12자리 → 체크디지트 계산",
    };
  }

  if (len === 13) {
    const cd = ean13CheckDigit(digits.slice(0, 12));
    if (cd === parseInt(digits[12], 10)) {
      return {
        type: "EAN-13",
        status: "이미 완성",
        full: digits,
        note: "13자리 그대로 유효",
      };
    }
    return {
      type: "EAN-13",
      status: "불일치",
      full: digits,
      note: "체크디지트가 맞지 않음 — 직접 확인 필요",
    };
  }

  return {
    type: "알수없음",
    status: "확인필요",
    full: digits,
    note: `자릿수 ${len}개 — 표준 길이(11/12/13) 아님`,
  };
}

/* ---------- helpers ---------- */
function bestColumnGuess(rows, headers, predicate) {
  let bestIdx = 0,
    bestScore = -1;
  headers.forEach((_, idx) => {
    let score = 0;
    rows.slice(0, 30).forEach((r) => {
      if (predicate(r[idx])) score++;
    });
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

function BarcodeStripe({ progress = 0, height = 10 }) {
  // decorative signature: a barcode made of bars, filling with amber as progress increases
  const bars = 40;
  const filled = Math.round(bars * progress);
  return (
    <div style={{ display: "flex", gap: 2, height, width: "100%" }}>
      {Array.from({ length: bars }).map((_, i) => {
        const w = (i * 37) % 5 === 0 ? 3 : (i * 13) % 7 === 0 ? 1 : 2;
        return (
          <div
            key={i}
            style={{
              width: w,
              flexGrow: 1,
              background: i < filled ? COLORS.amber : COLORS.line,
              borderRadius: 1,
              transition: "background 0.25s ease",
            }}
          />
        );
      })}
    </div>
  );
}

export default function BarcodeFixApp() {
  const [tab, setTab] = useState("convert");
  const [rawRows, setRawRows] = useState(null); // array of arrays incl header
  const [headers, setHeaders] = useState([]);
  const [barcodeCol, setBarcodeCol] = useState(0);
  const [nameCol, setNameCol] = useState(0);
  const [costCol, setCostCol] = useState(-1); // -1 = none selected
  const [onlyWithCost, setOnlyWithCost] = useState(true);
  const [processed, setProcessed] = useState(null); // array of item objects
  const [fileName, setFileName] = useState("");
  const [checklist, setChecklist] = useState([]);
  const [search, setSearch] = useState("");
  const [storageMsg, setStorageMsg] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const fileInputRef = useRef(null);

  // load persisted checklist on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setChecklist(parsed);
        }
      } catch (e) {
        // no existing data — fine
      } finally {
        setLoadingList(false);
      }
    })();
  }, []);

  const persistChecklist = useCallback(async (items) => {
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(items), false);
    } catch (e) {
      setStorageMsg("저장 실패 — 다시 시도해주세요");
      setTimeout(() => setStorageMsg(""), 2500);
    }
  }, []);

  const handleFile = useCallback((file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (!rows.length) return;
      const hdrs = rows[0].map((h, i) => (h ? String(h) : `열 ${i + 1}`));
      const body = rows.slice(1).filter((r) => r.some((c) => c !== ""));
      setHeaders(hdrs);
      setRawRows(body);
      const guessBarcode = bestColumnGuess(body, hdrs, (v) => {
        const d = onlyDigits(v);
        return d.length >= 10 && d.length <= 13;
      });
      const guessName = bestColumnGuess(body, hdrs, (v) => {
        const s = (v ?? "").toString();
        return s.length > 1 && onlyDigits(s).length < s.length / 2;
      });
      setBarcodeCol(guessBarcode);
      setNameCol(guessName);

      const costHeaderIdx = hdrs.findIndex((h) =>
        /cost|원가|단가|매입/i.test(h)
      );
      setCostCol(costHeaderIdx);
      setProcessed(null);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const hasCostValue = useCallback(
    (row) => {
      if (costCol < 0) return true;
      const v = row[costCol];
      if (v === "" || v === null || v === undefined) return false;
      const num = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
      return !isNaN(num) && num > 0;
    },
    [costCol]
  );

  const runConversion = useCallback(() => {
    if (!rawRows) return;
    const source =
      onlyWithCost && costCol >= 0 ? rawRows.filter(hasCostValue) : rawRows;
    const results = source.map((r) => {
      const rawBarcode = r[barcodeCol];
      const name = r[nameCol];
      const resolved = resolveBarcode(rawBarcode);
      return {
        id: onlyDigits(rawBarcode) + "-" + Math.random().toString(36).slice(2, 7),
        name: (name ?? "").toString(),
        original: (rawBarcode ?? "").toString(),
        ...resolved,
        row: r,
      };
    });
    setProcessed(results);
  }, [rawRows, barcodeCol, nameCol, costCol, onlyWithCost, hasCostValue]);

  const summary = useMemo(() => {
    if (!processed) return null;
    const s = { total: processed.length, upc: 0, ean: 0, flagged: 0 };
    processed.forEach((p) => {
      if (p.type === "UPC-A") s.upc++;
      else if (p.type === "EAN-13") s.ean++;
      if (p.status === "확인필요" || p.status === "불일치") s.flagged++;
    });
    if (rawRows && onlyWithCost && costCol >= 0) {
      s.skipped = rawRows.length - processed.length;
    }
    return s;
  }, [processed, rawRows, onlyWithCost, costCol]);

  const downloadFile = useCallback(() => {
    if (!processed) return;
    const outRows = processed.map((p) => {
      const rowObj = {};
      headers.forEach((h, i) => {
        rowObj[h] = p.row[i];
      });
      rowObj["완성 바코드"] = p.full;
      rowObj["바코드 타입"] = p.type;
      rowObj["상태"] = p.status;
      rowObj["비고"] = p.note;
      return rowObj;
    });
    const ws = XLSX.utils.json_to_sheet(outRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "완성바코드");
    XLSX.writeFile(wb, `완성바코드_${fileName || "결과"}.xlsx`);
  }, [processed, headers, fileName]);

  const sendToChecklist = useCallback(async () => {
    if (!processed) return;
    const items = processed.map((p) => ({
      id: p.id,
      name: p.name || "(이름없음)",
      full: p.full,
      type: p.type,
      status: p.status,
      checked: false,
      checkedAt: null,
    }));
    setChecklist(items);
    await persistChecklist(items);
    setTab("checklist");
  }, [processed, persistChecklist]);

  const toggleCheck = useCallback(
    async (id) => {
      setChecklist((prev) => {
        const next = prev.map((it) =>
          it.id === id
            ? {
                ...it,
                checked: !it.checked,
                checkedAt: !it.checked ? new Date().toISOString() : null,
              }
            : it
        );
        persistChecklist(next);
        return next;
      });
    },
    [persistChecklist]
  );

  const resetChecklist = useCallback(async () => {
    const cleared = checklist.map((it) => ({ ...it, checked: false, checkedAt: null }));
    setChecklist(cleared);
    await persistChecklist(cleared);
  }, [checklist, persistChecklist]);

  const clearAll = useCallback(async () => {
    setChecklist([]);
    try {
      await window.storage.delete(STORAGE_KEY, false);
    } catch (e) {
      /* noop */
    }
  }, []);

  const filteredChecklist = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = checklist;
    if (q) {
      list = list.filter(
        (it) =>
          it.name.toLowerCase().includes(q) || it.full.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => Number(a.checked) - Number(b.checked));
  }, [checklist, search]);

  const checklistProgress = useMemo(() => {
    if (!checklist.length) return 0;
    return checklist.filter((c) => c.checked).length / checklist.length;
  }, [checklist]);

  return (
    <div
      style={{
        fontFamily: SANS,
        background: COLORS.bg,
        color: COLORS.text,
        minHeight: "100%",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      {/* header */}
      <div
        style={{
          padding: "20px 20px 14px",
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.14em",
                color: COLORS.amber,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              KIMCHI MART · 재고 도구
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "-0.02em",
              }}
            >
              바코드 체크디지트 복원기
            </h1>
          </div>
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { key: "convert", label: "① 파일 변환" },
            { key: "checklist", label: `② 매장 확인${checklist.length ? ` (${checklist.filter(c=>c.checked).length}/${checklist.length})` : ""}` },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${tab === t.key ? COLORS.amber : COLORS.line}`,
                background: tab === t.key ? "rgba(242,169,59,0.12)" : "transparent",
                color: tab === t.key ? COLORS.amber : COLORS.mute,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {tab === "convert" && (
          <div>
            {!rawRows && (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `1.5px dashed ${COLORS.line}`,
                  borderRadius: 14,
                  padding: "40px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: COLORS.surface,
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  벨라포스 다운로드 파일 올리기
                </div>
                <div style={{ fontSize: 13, color: COLORS.mute }}>
                  .xlsx / .xls / .csv — 상품명과 바코드 열이 포함된 파일
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => handleFile(e.target.files[0])}
                  style={{ display: "none" }}
                />
              </div>
            )}

            {rawRows && !processed && (
              <div
                style={{
                  background: COLORS.surface,
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 14 }}>
                  {fileName} · {rawRows.length}개 행 인식됨
                </div>

                <FieldSelect
                  label="바코드가 들어있는 열"
                  value={barcodeCol}
                  onChange={setBarcodeCol}
                  headers={headers}
                />
                <div style={{ height: 10 }} />
                <FieldSelect
                  label="상품명이 들어있는 열"
                  value={nameCol}
                  onChange={setNameCol}
                  headers={headers}
                />
                <div style={{ height: 10 }} />
                <FieldSelect
                  label="원가(cost)가 들어있는 열"
                  value={costCol}
                  onChange={setCostCol}
                  headers={headers}
                  allowNone
                />

                {costCol >= 0 && (
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 12,
                      fontSize: 13,
                      color: COLORS.mute,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={onlyWithCost}
                      onChange={(e) => setOnlyWithCost(e.target.checked)}
                    />
                    원가(cost)가 있는 상품만 변환하기
                  </label>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                  <button onClick={runConversion} style={primaryBtn}>
                    체크디지트 계산하기 →
                  </button>
                  <button
                    onClick={() => {
                      setRawRows(null);
                      setProcessed(null);
                    }}
                    style={ghostBtn}
                  >
                    다른 파일
                  </button>
                </div>
              </div>
            )}

            {processed && summary && (
              <div>
                {summary.skipped > 0 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: COLORS.mute,
                      marginBottom: 10,
                      padding: "8px 12px",
                      background: COLORS.surface,
                      border: `1px solid ${COLORS.line}`,
                      borderRadius: 8,
                    }}
                  >
                    원가(cost) 없는 {summary.skipped}개 상품은 제외하고 변환했어요.
                  </div>
                )}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 8,
                    marginBottom: 16,
                  }}
                >
                  <StatCard label="전체" value={summary.total} />
                  <StatCard label="UPC-A" value={summary.upc} />
                  <StatCard label="EAN-13" value={summary.ean} />
                  <StatCard
                    label="확인필요"
                    value={summary.flagged}
                    color={summary.flagged ? COLORS.red : COLORS.mint}
                  />
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    marginBottom: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <button onClick={downloadFile} style={primaryBtn}>
                    ⬇ 완성 파일 다운로드
                  </button>
                  <button onClick={sendToChecklist} style={ghostBtnAmber}>
                    매장 확인용 체크리스트로 보내기 →
                  </button>
                  <button
                    onClick={() => {
                      setRawRows(null);
                      setProcessed(null);
                    }}
                    style={ghostBtn}
                  >
                    다른 파일
                  </button>
                </div>

                <div
                  style={{
                    border: `1px solid ${COLORS.line}`,
                    borderRadius: 12,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      maxHeight: 420,
                      overflowY: "auto",
                    }}
                  >
                    {processed.map((p, i) => (
                      <div
                        key={p.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 14px",
                          borderBottom:
                            i === processed.length - 1
                              ? "none"
                              : `1px solid ${COLORS.line}`,
                          background: i % 2 ? "transparent" : "rgba(255,255,255,0.015)",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p.name || "(이름없음)"}
                          </div>
                          <div
                            style={{
                              fontFamily: MONO,
                              fontSize: 13,
                              color: COLORS.amber,
                              marginTop: 2,
                            }}
                          >
                            {p.full}
                          </div>
                        </div>
                        <Tag type={p.type} />
                        <StatusTag status={p.status} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "checklist" && (
          <div>
            {loadingList ? (
              <div style={{ color: COLORS.mute, fontSize: 13 }}>불러오는 중…</div>
            ) : checklist.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  color: COLORS.mute,
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>🧾</div>
                아직 체크리스트가 없어요.
                <br />
                ① 탭에서 파일을 변환한 뒤 &ldquo;체크리스트로 보내기&rdquo;를 눌러주세요.
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 14 }}>
                  <BarcodeStripe progress={checklistProgress} />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 6,
                      fontSize: 12,
                      color: COLORS.mute,
                    }}
                  >
                    <span>
                      {checklist.filter((c) => c.checked).length} / {checklist.length}{" "}
                      확인 완료
                    </span>
                    {storageMsg && <span style={{ color: COLORS.red }}>{storageMsg}</span>}
                  </div>
                </div>

                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="상품명 또는 바코드로 검색…"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "11px 14px",
                    borderRadius: 10,
                    border: `1px solid ${COLORS.line}`,
                    background: COLORS.surface,
                    color: COLORS.text,
                    fontSize: 14,
                    marginBottom: 12,
                    outline: "none",
                  }}
                />

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 14,
                  }}
                >
                  <button onClick={resetChecklist} style={ghostBtn}>
                    체크 초기화
                  </button>
                  <button onClick={clearAll} style={ghostBtnDanger}>
                    목록 전체 삭제
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {filteredChecklist.map((it) => (
                    <div
                      key={it.id}
                      onClick={() => toggleCheck(it.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "14px 16px",
                        borderRadius: 12,
                        border: `1px solid ${it.checked ? COLORS.mint : COLORS.line}`,
                        background: it.checked
                          ? "rgba(52,211,153,0.08)"
                          : COLORS.surface,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 8,
                          border: `2px solid ${it.checked ? COLORS.mint : COLORS.mute}`,
                          background: it.checked ? COLORS.mint : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          fontSize: 15,
                          color: COLORS.bg,
                          fontWeight: 900,
                        }}
                      >
                        {it.checked ? "✓" : ""}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            textDecoration: it.checked ? "line-through" : "none",
                            color: it.checked ? COLORS.mute : COLORS.text,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {it.name}
                        </div>
                        <div
                          style={{
                            fontFamily: MONO,
                            fontSize: 13,
                            color: it.checked ? COLORS.mute : COLORS.amber,
                            marginTop: 2,
                          }}
                        >
                          {it.full}
                        </div>
                      </div>
                      <Tag type={it.type} small />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- small presentational bits ---------- */

function FieldSelect({ label, value, onChange, headers, allowNone }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: COLORS.mute, marginBottom: 6 }}>{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 10,
          border: `1px solid ${COLORS.line}`,
          background: COLORS.surface2,
          color: COLORS.text,
          fontSize: 14,
        }}
      >
        {allowNone && <option value={-1}>선택 안 함</option>}
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        padding: "12px 10px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          fontFamily: MONO,
          color: color || COLORS.text,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: COLORS.mute, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Tag({ type, small }) {
  const color = type === "UPC-A" ? "#7CB8F2" : type === "EAN-13" ? COLORS.amber : COLORS.red;
  return (
    <span
      style={{
        fontSize: small ? 10 : 11,
        fontWeight: 700,
        padding: small ? "3px 7px" : "4px 8px",
        borderRadius: 6,
        background: `${color}22`,
        color,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {type}
    </span>
  );
}

function StatusTag({ status }) {
  const color =
    status === "이미 완성"
      ? COLORS.mint
      : status === "계산됨"
      ? COLORS.amber
      : COLORS.red;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "4px 8px",
        borderRadius: 6,
        background: `${color}22`,
        color,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {status}
    </span>
  );
}

const primaryBtn = {
  padding: "11px 18px",
  borderRadius: 10,
  border: "none",
  background: COLORS.amber,
  color: "#1A1300",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
};

const ghostBtn = {
  padding: "11px 18px",
  borderRadius: 10,
  border: `1px solid ${COLORS.line}`,
  background: "transparent",
  color: COLORS.mute,
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const ghostBtnAmber = {
  ...ghostBtn,
  border: `1px solid ${COLORS.amber}`,
  color: COLORS.amber,
};

const ghostBtnDanger = {
  ...ghostBtn,
  border: `1px solid ${COLORS.red}55`,
  color: COLORS.red,
};
