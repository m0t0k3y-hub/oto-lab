// 小さな DOM ヘルパー。型は扱いやすさ優先で any を返す。
export const $ = (s: string, r: ParentNode = document): any => r.querySelector(s);
export const $$ = (s: string, r: ParentNode = document): any[] => [...r.querySelectorAll(s)];

type Child = Node | string | number | null | undefined | false | Child[];

export function h(tag: string, attrs: Record<string, any> = {}, ...kids: Child[]): any {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of (kids as any[]).flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
