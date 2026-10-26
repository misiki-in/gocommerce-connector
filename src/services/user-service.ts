import type { AuthResponse, Customer, Order } from '../engine'
import { GoCommerceError, NotSupportedError } from '../errors'
import { toOrder, toUser } from '../map'
import { endSession, placedOrder, startSession, storedCartId, updateMe } from '../browser'
import { StoreFacts } from './facts'
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
	/**
	 * Email and password. The answer is the user object the storefront keeps in its `me` cookie.
	 * With `phone` and `phoneToken` from `verifyOtp({ askIfNew: true })`, the phone is added to
	 * the account as it signs in (D123).
	 */
	async login({
		email,
		password,
		phone,
		phoneToken,
	}: {
		email: string
		password: string
		phone?: string
		phoneToken?: string
		cartId?: string | null
	}) {
		const auth = await this.account<AuthResponse>('/x/identity/login', {
			method: 'POST',
			body: {
				email: String(email ?? '').trim(),
				password: String(password ?? ''),
				...(phoneToken ? { phone: String(phone ?? '').trim(), phone_token: phoneToken } : {}),
			},
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

	protected async signedIn(auth: AuthResponse) {
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
 * Password resets, email confirmation, and phone sign-in. A store signs its
 * customers in one way (D116), read from `loginMethod`; the engine refuses
 * the other.
 */
export class AuthService extends UserService {
	private readonly facts = new StoreFacts(this._fetch)

	/**
	 * How this store signs customers in: `email_password` or `phone_otp`.
	 * A store whose accounts module says nothing signs in by email.
	 */
	async loginMethod(): Promise<'email_password' | 'phone_otp' | 'email_or_phone'> {
		try {
			const method = (await this.facts.plugins()).get('identity')?.settings?.login_method
			return method === 'phone_otp' || method === 'email_or_phone' ? method : 'email_password'
		} catch {
			return 'email_password'
		}
	}

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

	/**
	 * Texts a 4-digit sign-in code to `phone`, which needs its country code. `domain`, the page's
	 * host and in the browser read from it, lets the engine end the text "@domain #code" when the
	 * host is the store's own, which Chrome on Android reads to fill the code in (D124).
	 */
	async getOtp({ phone, domain }: { phone: string; domain?: string }) {
		const site = domain ?? (typeof window !== 'undefined' ? window.location?.hostname : undefined)
		const res = await this.account<{ expires_in_minutes: number }>('/x/identity/otp', {
			method: 'POST',
			body: { phone: String(phone ?? '').trim(), ...(site ? { domain: site } : {}) },
		})
		return { expiresInMinutes: res?.expires_in_minutes ?? 10 }
	}

	/**
	 * Signs in the account on `phone` with the code it was sent, opening one the first time.
	 * With `askIfNew`, on a store that signs in either way, a phone with no account opens none:
	 * the answer is `{ newPhone: true, phoneToken }`, and the storefront asks "Already have an
	 * account?" — `login` with the token adds the phone to it, `openPhoneAccount` opens a new one (D123).
	 */
	async verifyOtp({ phone, otp, askIfNew }: { phone: string; otp: string; askIfNew?: boolean }) {
		const res = await this.account<AuthResponse | { new_phone: true; phone_token: string }>('/x/identity/otp/verify', {
			method: 'POST',
			body: {
				phone: String(phone ?? '').trim(),
				code: String(otp ?? '').trim(),
				...(askIfNew ? { ask_if_new: true } : {}),
			},
		})
		if ('new_phone' in res && res.new_phone) return { newPhone: true as const, phoneToken: res.phone_token }
		return this.signedIn(res as AuthResponse)
	}

	/** Opens a new account on a phone `verifyOtp({ askIfNew: true })` proved, and signs it in (D123). */
	async openPhoneAccount({ phone, phoneToken }: { phone: string; phoneToken: string }) {
		const auth = await this.account<AuthResponse>('/x/identity/otp/new-account', {
			method: 'POST',
			body: { phone: String(phone ?? '').trim(), phone_token: phoneToken },
		})
		return this.signedIn(auth)
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

	/** Texts a code to a phone the signed-in shopper wants to add (D118). */
	async requestPhoneLink({ phone }: { phone: string }) {
		const res = await this.account<{ expires_in_minutes: number }>('/x/identity/me/phone', {
			method: 'POST',
			auth: true,
			body: { phone: String(phone ?? '').trim() },
		})
		return { expiresInMinutes: res?.expires_in_minutes ?? 10 }
	}

	/** Adds the phone with its code; from then on it signs in to this account too. */
	async verifyPhoneLink({ phone, otp }: { phone: string; otp: string }) {
		const c = await this.account<Customer>('/x/identity/me/phone/verify', {
			method: 'POST',
			auth: true,
			body: { phone: String(phone ?? '').trim(), code: String(otp ?? '').trim() },
		})
		updateMe(c)
		return toUser(c)
	}
}

export const userService = new UserService()
export const authService = new AuthService()
export const profileService = new ProfileService()
