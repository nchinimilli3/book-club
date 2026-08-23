export type BookSearchResult = {
  key:string; title:string; author:string; cover:string; year?:number; isbn?:string; pages?:number;
};

export async function searchBooks(query:string): Promise<BookSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const openUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=18&fields=key,title,author_name,cover_i,first_publish_year,isbn,number_of_pages_median`;
  try {
    const res = await fetch(openUrl);
    if (!res.ok) throw new Error('Open Library unavailable');
    const data = await res.json();
    const primary = (data.docs ?? []).map((d:any) => ({
      key:d.key,
      title:d.title,
      author:d.author_name?.[0] ?? 'Unknown author',
      cover:d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '',
      year:d.first_publish_year,
      isbn:d.isbn?.[0],
      pages:d.number_of_pages_median,
    })).filter((b:BookSearchResult) => b.cover);
    if (primary.length) return primary;
  } catch {}

  const googleUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=18`;
  const res = await fetch(googleUrl);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items ?? []).map((item:any) => {
    const v = item.volumeInfo ?? {};
    return {
      key:item.id,
      title:v.title,
      author:v.authors?.[0] ?? 'Unknown author',
      cover:(v.imageLinks?.thumbnail ?? '').replace('http://','https://').replace('&zoom=1','&zoom=2'),
      year:Number((v.publishedDate ?? '').slice(0,4)) || undefined,
      isbn:v.industryIdentifiers?.[0]?.identifier,
      pages:v.pageCount,
    };
  }).filter((b:BookSearchResult) => b.cover);
}
