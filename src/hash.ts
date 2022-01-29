import assert = require('assert');
import * as bitcoin from 'bitcoinjs-lib';

export class Hash {
  private readonly hash: Buffer;
  public readonly string: string;

	constructor(hash: Buffer | string) {
		if (typeof hash === 'string') {
			this.hash = Buffer.from(hash, 'hex').reverse();
		} else {
			this.hash = hash;
		}
		assert(hash.length == 32);
    this.string = this.buffer.reverse().toString('hex');
  }

	static fromData(data: Buffer) {
		return new this(bitcoin.crypto.hash256(data));
	}

	get buffer() {
		const clone = Buffer.allocUnsafe(32);
		this.hash.copy(clone);
		return clone;
	}

	toString() {
		return this.string;
	}
}
