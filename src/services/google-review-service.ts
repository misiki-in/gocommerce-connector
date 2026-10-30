import { placedOrder } from '../browser'
import type { GooglePlace, GoogleSurvey } from '../engine'
import { GoCommerceError } from '../errors'
import { BaseService } from './base.service'
import { StoreFacts } from './facts'

const PLUGIN = 'google-reviews'

/** A Google review with what Google's attribution policy asks a storefront to show. */
export type GoogleReview = {
	author: string
	/** The author's Google profile and photo; https or empty. */
	authorUrl: string
	authorPhoto: string
	rating: number
	/** The reviewer's own words, in their language. Empty for a rating with no words. */
	text: string
	language: string
	/** Google's own words for when, such as "a month ago". */
	when: string
	/** YYYY-MM, when Google has one. */
	visited: string
	/** The review on Google Maps, and where to report it to Google. */
	url: string
	reportUrl: string
}

export type GoogleReviews = {
	/** Google's own rating and count, never worked out from `reviews`. */
	rating: number
	count: number
	/** Every review, on Google Maps: `reviews` are at most five of them. */
	mapsUrl: string
	reviews: GoogleReview[]
}

/**
 * The store's Google reviews and Google Customer Reviews (ext/google-reviews).
 *
 * Both calls answer null when there is nothing to show — the plugin or its
 * switch off, Google refusing, the day's lookups spent — because each is an
 * extra on a page that must render without it.
 */
export class GoogleReviewService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)

	/**
	 * Google's rating and its most relevant reviews, read live. Google's terms
	 * forbid keeping them, so nothing here caches them either, and every call
	 * is one the store pays Google for: call it when the section is in view.
	 */
	async place(): Promise<GoogleReviews | null> {
		if (!(await this.switchOn('show_place'))) return null
		const p = await this.orNull(() => this.data<GooglePlace>('/x/google-reviews/place'))
		if (!p?.user_rating_count) return null
		return {
			rating: p.rating,
			count: p.user_rating_count,
			mapsUrl: p.google_maps_uri ?? '',
			reviews: (p.reviews ?? []).map((r) => ({
				author: r.author?.name ?? '',
				authorUrl: r.author?.uri ?? '',
				authorPhoto: r.author?.photo_uri ?? '',
				rating: r.rating,
				text: r.text ?? '',
				language: r.language ?? '',
				when: r.relative_time ?? '',
				visited: r.visit_date ?? '',
				url: r.google_maps_uri ?? '',
				reportUrl: r.flag_uri ?? '',
			})),
		}
	}

	/**
	 * What Google Customer Reviews' opt-in is rendered with, for an order placed
	 * in this browser: its access token is kept here, and nowhere else can ask.
	 * Every field is the order's own; the keys are Google's, to pass unchanged
	 * to `gapi.surveyoptin.render`.
	 */
	async survey(orderNumber: string): Promise<GoogleSurvey | null> {
		const kept = orderNumber ? placedOrder(orderNumber) : undefined
		if (!kept || !(await this.switchOn('customer_reviews'))) return null
		return this.orNull(() =>
			this.data<GoogleSurvey>(`/x/google-reviews/survey/${encodeURIComponent(orderNumber)}`, {
				query: { token: kept.token },
			}),
		)
	}

	private async switchOn(setting: string): Promise<boolean> {
		try {
			return (await this.facts.plugins()).get(PLUGIN)?.settings?.[setting] === true
		} catch {
			return false
		}
	}

	/** Off, used up for the day, or refused by Google: nothing to show. Anything else still throws. */
	private async orNull<T>(call: () => Promise<T>): Promise<T | null> {
		try {
			return await call()
		} catch (err) {
			if (err instanceof GoCommerceError && [404, 429, 502].includes(err.status)) return null
			throw err
		}
	}
}

export const googleReviewService = new GoogleReviewService()
