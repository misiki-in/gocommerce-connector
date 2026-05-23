/**
 * The two ways a call through this connector fails.
 *
 * Both carry `message`, because the storefront shows `err.message` in a toast
 * and has no other field it reliably reads.
 */

/**
 * What the engine refused, in a shape the storefront can show a shopper.
 *
 * `status` travels because the difference between 404 and 409 is the
 * difference between "that product is gone" and "somebody just bought the last
 * one", and a storefront renders those differently. `code` is the engine's own
 * taxonomy (`not_found`, `validation`, `conflict`, `unauthorized`, …).
 */
export class GoCommerceError extends Error {
	readonly status: number
	readonly code: string | undefined
	readonly details: unknown

	constructor(message: string, status: number, code?: string, details?: unknown) {
		super(message)
		this.name = 'GoCommerceError'
		this.status = status
		this.code = code
		this.details = details
	}
}

/**
 * A storefront feature this engine has no model for — reels, chat, a vendor's
 * commission statement — or one that lives in a module this particular build
 * did not compile in.
 *
 * The name is the one every connector in the family throws, so a storefront
 * that branches on `err.name === 'NotSupportedError'` treats GoCommerce the same
 * as the rest.
 */
export class NotSupportedError extends Error {
	readonly service: string
	readonly method: string

	constructor(service: string, method: string, detail?: string) {
		super(`${service}.${method}() is not supported by GoCommerce${detail ? `: ${detail}` : '.'}`)
		this.name = 'NotSupportedError'
		this.service = service
		this.method = method
	}
}
