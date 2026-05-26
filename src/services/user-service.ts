import type { AuthResponse, Customer, Order } from '../engine'
import { GoCommerceError, NotSupportedError } from '../errors'
import { toOrder, toUser } from '../map'
import { endSession, placedOrder, startSession, storedCartId, updateMe } from '../browser'
import { BaseService } from './base.service'

/**
 * Shopper accounts, through ext/identity.
 *
 * Guest checkout stays the engine's default (D22): an account is a place to
 * keep addresses and see past orders, never a requirement to buy. A store
 * built without `-identity` answers every call here with a 404, which arrives
 * as "Accounts are not available on this store" rather than as a route error.
 */
export class UserService extends BaseService {
	/** Email and password. The answer is the user object the storefront keeps in its `me` cookie. */
	async login({ email, password }: { email: string; password: string; cartId?: string | null }) {
		const auth = await this.account<AuthResponse>('/x/identity/login', {
			method: 'POST',
			body: { email: String(email ?? '').trim(), password: String(password ?? '') },
		})
		return this.signedIn(auth)
	}

	async signup({
		email,
		password,
		firstName,
		lastName,
		phone,
	}: {
		email: string
		password: string
		firstName?: string
		lastName?: string
		phone?: string
		cartId?: string | null
		origin?: string
	}) {
		const name = [firstName, lastName].filter(Boolean).join(' ').trim()
		const auth = await this.account<AuthResponse>('/x/identity/register', {
			method: 'POST',
			body: {
				email: String(email ?? '').trim(),
				password: String(password ?? ''),
				...(name ? { name } : {}),
				...(phone ? { phone: String(phone) } : {}),
			},
		})
		return this.signedIn(auth)
	}

	/** Signs out here and on the engine. The storefront assigns the answer to its user: `null`. */
	async logout() {
		await this.engine('/x/identity/logout', { method: 'POST', auth: true }).catch(() => undefined)
		endSession()
		return null
	}

	async getMe() {
		return toUser(await this.account<Customer>('/x/identity/me', { auth: true }))
	}

	async updateProfile(user: { firstName?: string; lastName?: string; name?: string; email?: string; phone?: string }) {
		const name =
			user.name ??
			[user.firstName, user.lastName]
				.filter((v) => v !== undefined)
				.join(' ')
				.trim()
		const c = await this.account<Customer>('/x/identity/me', {
			method: 'PATCH',
			auth: true,
			body: {
				...(name !== undefined ? { name } : {}),
				...(user.email ? { email: String(user.email).trim() } : {}),
				...(user.phone !== undefined && user.phone !== null ? { phone: String(user.phone) } : {}),
			},
		})
		updateMe(c)
		return toUser(c)
	}

	/**
	 * A password change ends every session the account had, this one included,
	 * and the engine answers a fresh one — which is kept, so the shopper stays
	 * signed in here and nowhere else.
	 */
	async changePassword({ old, oldPassword, password }: { old?: string; oldPassword?: string; password: string }) {
		const auth = await this.account<AuthResponse>('/x/identity/me/password', {
			method: 'PUT',
			auth: true,
			body: { current_password: String(old ?? oldPassword ?? ''), password: String(password ?? '') },
		})
		startSession(auth)
		return toUser(auth.record)
	}

	/**
	 * Mails the signed-in shopper a link to confirm their address. The engine
	 * sends none at signup, and a confirmed address is what customer-group
	 * prices are keyed on. 409 once confirmed; 429 within a minute of the last.
	 */
	async requestEmailVerification() {
		return this.account<{ accepted: boolean }>('/x/identity/me/email-verification', { method: 'POST', auth: true })
	}

	/** Extends the session another thirty days. The token stays the same. */
	async refreshSession() {
		return startSession(await this.account<AuthResponse>('/x/identity/refresh', { method: 'POST', auth: true }))
	}

	/**
	 * Files a guest order under the signed-in account, so it appears in their
	 * order history. The order's access token is the proof of ownership: pass
	 * it, or leave it out for an order placed from this browser, whose token was
	 * kept at checkout.
	 *
	 * Never done automatically at sign-in. On a shared computer that would file
	 * one person's orders — address and all — under whoever signed in next.
	 */
	async claimOrder({ number, token }: { number: string; token?: string }) {
		const proof = token ?? placedOrder(number)?.token
		if (!proof) {
			throw new GoCommerceError(
				'This order was not placed from this browser; enter the code from its confirmation.',
				400,
			)
		}
		const order = await this.account<Order>('/x/identity/me/orders', {
			method: 'POST',
			auth: true,
			body: { number: String(number), token: proof },
		})
		return toOrder(order)
	}

	async deleteUser(): Promise<never> {
		throw new NotSupportedError('UserService', 'deleteUser', 'an account is closed by the store, on request')
	}

	async checkEmail(): Promise<never> {
		throw new NotSupportedError('UserService', 'checkEmail', 'the engine does not say which addresses have accounts')
	}

	async joinAsVendor(): Promise<never> {
		throw new NotSupportedError('UserService', 'joinAsVendor', 'sellers are invited by the store')
	}

	private async signedIn(auth: AuthResponse) {
		const me = startSession(auth)
		const cartId = storedCartId()
		if (cartId) await this.claimCartForAccount(cartId)
		return me
	}

	/** An identity call, with a 404 from a build without the module said in words. */
	protected async account<T>(path: string, req: Parameters<BaseService['engine']>[1] = {}): Promise<T> {
		try {
			return await this.data<T>(path, req)
		} catch (err) {
			if (err instanceof GoCommerceError && err.status === 404 && /no route/i.test(err.message)) {
				throw new GoCommerceError('Accounts are not available on this store.', 404, 'not_found')
			}
			if (err instanceof GoCommerceError && err.status === 401 && req.auth) endSession()
			throw err
		}
	}
}

/**
 * Password resets and email confirmation. Phone sign-in by one-time code is a
 * Litekart flow; the engine has no such thing and says so.
 */
export class AuthService extends UserService {
	async forgotPassword({ email }: { email: string; referrer?: string }) {
		return this.account<{ accepted: boolean }>('/x/identity/password-reset', {
			method: 'POST',
			body: { email: String(email ?? '').trim() },
		})
	}

	/** The token arrives in the link the engine emailed (`GOCOMMERCE_IDENTITY_RESET_URL`). */
	async resetPassword({ token, password }: { userId?: string; token: string; password: string }) {
		const auth = await this.account<AuthResponse>('/x/identity/password-reset/confirm', {
			method: 'POST',
			body: { token: String(token ?? ''), password: String(password ?? '') },
		})
		return startSession(auth)
	}

	/** Answers `{ errorCode, message }` on failure rather than throwing: that is how the page reads it. */
	async verifyEmail(_email: string | undefined, token: string) {
		try {
			const c = await this.account<Customer>('/x/identity/email-verification/confirm', {
				method: 'POST',
				body: { token: String(token ?? '') },
			})
			return { ...toUser(c), message: 'Your email address is confirmed.' }
		} catch (err) {
			return { errorCode: (err as GoCommerceError).code ?? 'invalid_token', message: (err as Error).message }
		}
	}

	async getOtp(): Promise<never> {
		throw new NotSupportedError('AuthService', 'getOtp', 'sign in with an email and password')
	}

	async verifyOtp(): Promise<never> {
		throw new NotSupportedError('AuthService', 'verifyOtp', 'sign in with an email and password')
	}

	async joinAsAdmin(): Promise<never> {
		throw new NotSupportedError('AuthService', 'joinAsAdmin', 'operators are invited from the admin panel')
	}
}

/** The `/my/profile` form: the same account, read and saved. */
export class ProfileService extends UserService {
	async getOne() {
		return this.getMe()
	}

	async save(profile: { firstName?: string; lastName?: string; email?: string; phone?: string }) {
		return this.updateProfile(profile)
	}
}

export const userService = new UserService()
export const authService = new AuthService()
export const profileService = new ProfileService()
