import { Hash } from './hash';

export interface Block {
	header: BlockHeader;
	transactions: TX[];
	size: number;
}

export interface BlockHeader {
	version: number;
	prevHash: Hash;
	merkleRoot: Hash;
	timestamp: number;
	bits: number;
	nonce: number;
	height: number;
	hash: Hash;
	raw: Buffer;
}

export interface TXin {
	vin: number;
	txid: Hash;
	vout: number;
	sigScript: Buffer;
	sequence: number;
	witness: Buffer[];
}

export interface TXout {
	vout: number;
	amount: BigInt;
	scriptPubKey: Buffer;
}

export interface TX {
	version: number;
	segwit: boolean;
	vin: TXin[];
	vout: TXout[];
	locktime: number;
	txid: Hash;
	hash: Hash;
	raw: Buffer;
	rawLegacy: Buffer;
}
