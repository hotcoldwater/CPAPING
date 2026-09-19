const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tags = new Set('p div span br strong b em i u s blockquote pre h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tfoot tr td th a img hr'.split(' '));
const drop = new Set('script style iframe object embed form input button svg math noscript'.split(' '));
function safeURL(value, image = false) {
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value)) return null;
  try {
    const u = new URL(value);
    if (u.username || u.password) return null;
    if (!['https:','http:',...(!image ? ['mailto:','tel:'] : [])].includes(u.protocol)) return null;
    if (image && u.protocol === 'http:') u.protocol = 'https:';
    return u.href;
  } catch { return null; }
}
function renderNodes(nodes, depth = 0) {
  if (!Array.isArray(nodes) || depth > 60) return '';
  return nodes.map(n => {
    if (typeof n === 'string') return esc(n);
    if (!n || typeof n !== 'object' || drop.has(n.tag)) return '';
    const children = renderNodes(n.children, depth+1);
    if (!tags.has(n.tag)) return children;
    if (n.tag === 'img') {
      const src = safeURL(n.src,true);
      return src ? `<span class="source-image"><a href="${esc(src)}" target="_blank" rel="noopener noreferrer"><img src="${esc(src)}" alt="${esc(n.alt || '채용 공고 이미지')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a><a class="image-original" href="${esc(src)}" target="_blank" rel="noopener noreferrer">이미지 원본 보기 ↗</a></span>` : '';
    }
    if (n.tag === 'a') {
      const href = safeURL(n.href);
      return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${children}</a>` : children;
    }
    if (n.tag === 'br' || n.tag === 'hr') return `<${n.tag}>`;
    const attrs = ['td','th'].includes(n.tag) ? ['colspan','rowspan'].filter(k=>Number.isInteger(n[k]) && n[k]>=1 && n[k]<=50).map(k=>` ${k}="${n[k]}"`).join('') : '';
    const start = n.tag === 'ol' && Number.isSafeInteger(n.start) && n.start >= 0 ? ` start="${n.start}"` : '';
    // Document headings belong under the page's sole h1.
    const tag = /^h[1-6]$/.test(n.tag) ? 'h3' : n.tag;
    const result = `<${tag}${attrs}${start}>${children}</${tag}>`;
    return tag === 'table' ? `<div class="source-table" tabindex="0" role="region" aria-label="공고 본문 표">${result}</div>` : result;
  }).join('');
}
export function renderPostingContent(p) {
  const source = p.source_content?.version === 1 ? p.source_content : null;
  const original = safeURL(p.detail_url);
  const html = source ? renderNodes(source.nodes) : '';
  const body = html.trim() || (p.body ? `<div class="source-plain">${esc(p.body)}</div>` : '');
  const otherHTML = renderNodes(source?.other_nodes);
  const other = /<img\b|<hr\b/.test(otherHTML) || otherHTML.replace(/<[^>]*>|&nbsp;/g, '').trim()
    ? otherHTML : '';
  let checked = '';
  if (p.content_fetched_at && !Number.isNaN(Date.parse(p.content_fetched_at))) {
    checked = new Intl.DateTimeFormat('ko-KR',{ timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(p.content_fetched_at));
  }
  const contacts = (Array.isArray(source?.contacts) ? source.contacts : []).filter(c=>c && typeof c.label==='string' && typeof c.value==='string');
  const files = (Array.isArray(source?.attachments) ? source.attachments : []).filter(f=>f && typeof f.name==='string');
  const contactRows = contacts.map(c=> {
    const mail = c.label === '이메일' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.value) ? safeURL('mailto:'+c.value) : null;
    return `<div><dt>${esc(c.label)}</dt><dd>${mail ? `<a href="${esc(mail)}">${esc(c.value)}</a>` : esc(c.value)}</dd></div>`;
  }).join('');
  const fileRows = files.map(f=> {
    const direct = safeURL(f.url), href = direct || original;
    return `<li><span class="attachment-name">${esc(f.name)}</span>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${direct ? '파일 열기' : '원문에서 받기'} ↗</a>` : ''}</li>`;
  }).join('');
  return `<section class="posting-content" aria-labelledby="posting-content-title">
    <div class="sec-head"><h2 id="posting-content-title">채용 내용</h2>${original ? `<a class="more" href="${esc(original)}" target="_blank" rel="noopener noreferrer">한공회 원문 ↗</a>` : ''}</div>
    <div class="source-meta">한국공인회계사회 게시 공고${checked ? ` · 내용 확인 ${esc(checked)}` : ''}</div>
    ${body ? `<div class="source-document">${body}</div>` : `<p class="source-empty">아직 가져온 본문이 없습니다. 한공회 원문에서 채용 내용을 확인해 주세요.</p>`}
    ${other ? `<div class="source-other" aria-labelledby="posting-other-title"><h2 id="posting-other-title">기타정보</h2><div class="source-document">${other}</div></div>` : ''}
    ${contactRows ? `<div class="source-contacts"><h3>지원·문의</h3><dl>${contactRows}</dl></div>` : ''}
    ${fileRows ? `<div class="source-attachments"><h3>첨부파일</h3><ul>${fileRows}</ul>${files.some(f=>!safeURL(f.url)) ? '<p class="note">한공회 다운로드 절차가 필요한 파일은 원문 페이지에서 받을 수 있습니다.</p>' : ''}</div>` : ''}
    <p class="note">수집 후 내용이 변경될 수 있습니다. 지원 전 원문에서 마감일과 제출 방법을 확인해 주세요.</p>
  </section>`;
}
