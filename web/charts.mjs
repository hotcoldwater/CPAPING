/**
 * 법인 페이지의 차트. 빌드할 때 SVG 로 그려 HTML 에 심는다.
 *
 * 차트 라이브러리를 쓰지 않는다. 값이 다섯 해뿐이고, 정적으로 그려야
 * 검색엔진이 읽을 수 있기 때문이다.
 *
 * 색은 눈으로 고르지 않고 검증기를 돌려 통과한 팔레트만 쓴다.
 * 처음 잡았던 파란 단색 램프는 명도·채도·대비에서 모두 실패했다.
 */

// 검증 통과: 인접쌍 CVD ΔE 9.1, 일반시야 ΔE 22.9 (라이트 배경)
export const SERIES = {
  audit: { label: "감사", color: "#2a78d6" },
  tax: { label: "세무", color: "#eb6834" },
  deal: { label: "딜자문", color: "#1baf7a" },
  other: { label: "기타", color: "#eda100" },
};

const INK = "#101317";
const INK_2 = "#5B6472";
const INK_3 = "#868D99";
const GRID = "#EDEFF2";
const SURFACE = "#FFFFFF";

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** 눈금을 사람이 읽기 좋은 값으로 올린다. 137 → 150, 34 → 40 */
function niceMax(value) {
  if (value <= 0) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(value))) / 2;
  return Math.ceil(value / step) * step;
}

function ticks(max, count = 3) {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

/**
 * 누적 막대. 매출 추이와 인력 추이가 함께 쓴다.
 *
 * rows: [{ label, segments: [{key, value}], total }]
 * 세그먼트 사이에 2px 를 비워 경계가 색만으로 갈리지 않게 한다.
 */
export function stackedBars({ rows, series, unit, totalLabel = (t) => t }) {
  const W = 620, H = 230;
  const padL = 42, padR = 12, padT = 26, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const max = niceMax(Math.max(...rows.map((r) => r.total)));
  const y = (v) => padT + plotH - (v / max) * plotH;
  const band = plotW / rows.length;
  const barW = Math.min(46, band * 0.5);

  const grid = ticks(max)
    .map((t) => {
      const yy = y(t);
      return `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" ` +
             `stroke="${t === 0 ? "#E4E6EA" : GRID}" stroke-width="1"/>` +
             `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" ` +
             `font-size="10.5" fill="${INK_3}">${Math.round(t)}</text>`;
    })
    .join("");

  const bars = rows
    .map((row, i) => {
      const cx = padL + band * i + band / 2;
      const x = cx - barW / 2;
      let cursor = 0;
      const segs = row.segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const y0 = y(cursor + s.value);
          const y1 = y(cursor);
          cursor += s.value;
          // 세그먼트 사이 2px 를 비운다. 색이 비슷해도 경계가 보인다.
          const h = Math.max(1, y1 - y0 - 2);
          const { color, label } = series[s.key];
          return `<rect x="${x}" y="${y0}" width="${barW}" height="${h}" fill="${color}">` +
                 `<title>${esc(row.label)} ${esc(label)} ${s.value}${esc(unit)}</title></rect>`;
        })
        .join("");

      return `<g>${segs}` +
        `<text x="${cx}" y="${y(row.total) - 8}" text-anchor="middle" ` +
        `font-size="11" font-weight="600" fill="${INK}" ` +
        `style="font-variant-numeric:tabular-nums">${esc(totalLabel(row.total))}</text>` +
        `<text x="${cx}" y="${H - 12}" text-anchor="middle" font-size="10.5" ` +
        `fill="${INK_2}">${esc(row.label)}</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">` +
         `${grid}${bars}</svg>`;
}

/** 범례. 2개 이상이면 반드시 붙인다 — 색만으로 구분하게 두지 않는다. */
export function legend(keys, series) {
  const items = keys
    .map((k) => {
      const { color, label } = series[k];
      return `<span class="lg-item"><i style="background:${color}"></i>${esc(label)}</span>`;
    })
    .join("");
  return `<div class="legend">${items}</div>`;
}

/** 100% 가로 막대. 올해 부문 구성을 한 줄로 보여준다. */
export function shareBar(segments, series) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return "";
  const parts = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const pct = (s.value / total) * 100;
      const { color, label } = series[s.key];
      return `<div class="share-seg" style="width:${pct}%;background:${color}" ` +
             `title="${esc(label)} ${pct.toFixed(1)}%"></div>`;
    })
    .join("");
  const labels = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const pct = (s.value / total) * 100;
      const { color, label } = series[s.key];
      return `<span class="share-label"><i style="background:${color}"></i>` +
             `${esc(label)} <b>${pct.toFixed(1)}%</b></span>`;
    })
    .join("");
  return `<div class="share">${parts}</div><div class="share-labels">${labels}</div>`;
}

/**
 * 수습회계사 채용 이력.
 *
 * 값이 다섯 개뿐이고 0 인 해가 많다. 막대 차트로 그리면 빈 해가 그냥
 * 사라져 "자료가 없는 것" 처럼 보인다. 0 도 테두리로 그려서 "뽑지 않은 해"
 * 임을 분명히 한다.
 */
export function traineeHistory(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const cells = rows
    .map((r) => {
      const h = r.value === 0 ? 4 : Math.round(6 + (r.value / max) * 40);
      const filled = r.value > 0;
      return `<div class="th-cell">` +
        `<div class="th-value${filled ? "" : " zero"}">${r.value}명</div>` +
        `<div class="th-bar${filled ? "" : " zero"}" style="height:${h}px"></div>` +
        `<div class="th-year">${esc(r.label)}</div></div>`;
    })
    .join("");
  return `<div class="trainee">${cells}</div>`;
}

/** 대비가 낮은 색이 섞이면 표를 함께 둔다. 검증기의 경고에 대한 대응이다. */
export function dataTable(headers, rows) {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const tr = rows
    .map((r) => `<tr>${r.map((c, i) =>
      i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="scroll"><table class="data"><thead><tr>${th}</tr></thead>` +
         `<tbody>${tr}</tbody></table></div>`;
}

export const CHART_CSS = `
.legend { display:flex; flex-wrap:wrap; gap:14px; margin-bottom:10px; }
.lg-item { display:flex; align-items:center; gap:6px; font-size:11.5px; color:${INK_2}; }
.lg-item i { width:9px; height:9px; border-radius:2px; flex:none; }

.chart { overflow-x:auto; }
.chart svg { display:block; min-width:340px; }

.share { display:flex; height:26px; border-radius:3px; overflow:hidden; gap:2px; background:${SURFACE}; }
.share-seg { height:100%; }
.share-labels { display:flex; flex-wrap:wrap; gap:12px; margin-top:8px; }
.share-label { display:flex; align-items:center; gap:5px; font-size:11.5px; color:${INK_2}; }
.share-label i { width:9px; height:9px; border-radius:2px; flex:none; }
.share-label b { color:${INK}; font-weight:600; font-variant-numeric:tabular-nums; }

.trainee { display:flex; align-items:flex-end; gap:4px; }
.th-cell { flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; }
.th-value { font-size:12.5px; font-weight:600; color:#8A5A19; font-variant-numeric:tabular-nums; }
.th-value.zero { color:${INK_3}; font-weight:400; }
.th-bar { width:100%; max-width:44px; background:#8A5A19; border-radius:3px 3px 0 0; }
.th-bar.zero { background:transparent; border:1px dashed #D5D8DD; border-radius:2px; }
.th-year { font-size:10.5px; color:${INK_2}; }

table.data { border-collapse:collapse; width:100%; font-size:12px; min-width:400px; }
table.data th, table.data td {
  padding:7px 10px 7px 0; text-align:right; border-bottom:1px solid ${GRID};
  font-variant-numeric:tabular-nums;
}
table.data thead th { font-size:11px; color:${INK_3}; font-weight:600; border-bottom:1px solid #E4E6EA; }
table.data th[scope="row"] { text-align:left; font-weight:500; color:${INK}; }
table.data tbody tr:last-child td, table.data tbody tr:last-child th { border-bottom:0; }
`;
