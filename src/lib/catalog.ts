import type { DiscoveryBook } from './api';
import type { BookSearchResult } from './books';

export type CatalogSource='nyt'|'google'|'supabase';
export type CatalogBook={
  key:string;
  source:CatalogSource;
  title:string;
  author:string;
  cover?:string;
  year?:number;
  isbn?:string;
  subjects?:string[];
  rank?:number;
  listName?:string;
};

export function discoveryToCatalog(book:DiscoveryBook,source:Extract<CatalogSource,'nyt'>):CatalogBook{
  return {key:book.key,source,title:book.title,author:book.author,cover:book.cover,year:book.year,isbn:book.isbn,subjects:book.subjects,rank:book.rank,listName:book.listName};
}

export function searchResultToCatalog(book:BookSearchResult):CatalogBook{
  return {key:book.key,source:'google',title:book.title,author:book.author,cover:book.cover,year:book.year,isbn:book.isbn,subjects:book.subjects};
}

export function catalogToSearchResult(book:CatalogBook):BookSearchResult{
  return {key:book.key,source:'google',title:book.title,author:book.author,cover:book.cover ?? '',year:book.year,isbn:book.isbn,subjects:book.subjects};
}
