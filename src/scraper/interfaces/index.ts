export interface ScrapedMovie {
  slug: string;
  title: string;
  releaseYear: number;
  watchedBy: number;
  avgRating: number;
  synopsis: string;
  genres: string[];
  themes: string[];
  director: string[];
  cast: string[];
}

export interface ScrapedReview {
  userUid: string;
  movieUid: string;
  rating: number | null;
  reviewText: string;
}
