interface Env {
  BOOK_CLUB_API: Fetcher;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    return await context.env.BOOK_CLUB_API.fetch(context.request);
  } catch (error) {
    console.error('book-club-api service binding failed', error);
    return Response.json({
      error: 'Book Club API is not reachable from the deployed site.',
      apiReachable: false,
    }, { status: 502 });
  }
};
