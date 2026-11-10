import { REVIEW_DEPENDENCY } from '#lib/review.ts';
import { fetchReviewSummary } from '#lib/server/reviews.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends(REVIEW_DEPENDENCY);
	const user = await locals.getUser();
	if (!user) return { user, review: null };

	// O cabeçalho não pode derrubar a página: sem contagem, só some o número.
	const review = await fetchReviewSummary(locals.supabase, new Date()).catch(() => null);
	return { user, review };
};
