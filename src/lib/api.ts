const API = import.meta.env.VITE_API_BASE_URL || '';
export async function enrichBook(title:string, author:string) {
  if (!API) return null;
  const r = await fetch(`${API}/api/enrich?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`);
  if (!r.ok) return null;
  return r.json();
}
