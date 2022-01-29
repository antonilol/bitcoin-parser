import { readdirSync, readFileSync } from 'fs';
import BufferReader = require('buffer-reader');
import { Hash } from './hash';
import { BlockHeader, TXin, TXout, TX } from './interfaces';
import { forEachTX, forEachBlockHeader } from './analyze';

function nextVarUIntLE(br: BufferReader): number {
	const n = br.nextUInt8();
	const l = { 0xfd: 2, 0xfe: 4, 0xff: 8 }[n];
	if (l == 8) {
		const i = br.nextBuffer(8).readBigUInt64LE();
		if (i == BigInt(Number(i))) {
			return Number(i);
		}
		throw new Error('Too large 64bit integer');
	}
	if (l) {
		return br[`nextUInt${8 * l}LE`]();
	}
	return n;
};

function nextVarLengthBuffer(br: BufferReader): Buffer {
	const l = nextVarUIntLE(br);
	return br.nextBuffer(l);
};

const chain = 'test';

if (![ 'main', 'test', 'signet', 'regtest' ].includes(chain)) {
	console.error(`Unsupported network "${chain}"`);
	process.exit(1);
}

const magicBytes = {
	main:    0xf9beb4d9,
	test:    0x0b110907,
	signet:  0x0a03cf40,
	regtest: 0xfabfb5da
};

const datadir = {
	main:    '',
	test:    'testnet3/',
	signet:  'signet/',
	regtest: 'regtest/'
};

const folder = `${process.env.HOME}/.bitcoin/${datadir[chain]}blocks/`;
const files = readdirSync(folder).filter(x => x.match(/^blk[0-9]+.dat$/));

const heights: { [key: string]: number } = {};
const orphans: { [key: string]: BlockHeader } = {};

var genesis = true;

main();

async function main() {
	for (var i = 0; i < files.length; i++) {
		const file = folder + files[i];
		const buf = readFileSync(file);
		const r = new BufferReader(buf);
		var b = 0;

		console.log(`Parsing ${files[i]} (${i+1}/${files.length})`);

		while (r.tell() < buf.length) {
			const m = r.nextInt32BE();
			if (m == 0 && files.length == i + 1) {
				break;
			}
			if (m != magicBytes[chain]) {
				console.error(`Magic bytes of the ${b}${{1:'st',2:'nd',3:'rd'}[b]||'th'} block in ${files[i]} didn't match the network's magic bytes ${m}`);
				const n = Object.entries(magicBytes).find(x => x[1] == m);
				if (n) {
					console.error(`It does match the ones of ${n[0]}`);
				}
				process.exit(1);
			}

			const size = r.nextUInt32LE();

			// block header
			await parseBlockHeader(r, size);

			// TXs
			const txs = nextVarUIntLE(r);

			for (var t = 0; t < txs; t++) {
				const tx = await parseTX(r, buf);
				await forEachTX(tx);
			}

			b++;
		}

		console.log(`Finished block file, total blocks: ${Object.keys(heights).length}, orphan blocks: ${Object.keys(orphans).length}`);
	}
}

async function parseBlockHeader(r: BufferReader, size: number) {
	const rawHeader = r.nextBuffer(80);

	const h = new BufferReader(rawHeader);
	const version = h.nextUInt32LE();
	const prevHash = new Hash(h.nextBuffer(32));
	const merkleRoot = new Hash(h.nextBuffer(32));
	const timestamp = h.nextUInt32LE();
	const bits = h.nextUInt32LE();
	const nonce = h.nextUInt32LE();

	const header: BlockHeader = {
		version,
		prevHash,
		merkleRoot,
		timestamp,
		bits,
		nonce,
		height: undefined,
		hash: Hash.fromData(rawHeader),
		raw: rawHeader,
		size: size
	}

	if (genesis) {
		genesis = false;
		heights[header.hash.string] = 0;
		header.height = 0;
		await forEachBlockHeader(header);
	} else {
		const prevHeight = heights[prevHash.string];
		if (prevHeight === undefined) {
			orphans[header.hash.string] = header;
		} else {
			heights[header.hash.string] = prevHeight + 1;
			header.height = prevHeight + 1;
			await forEachBlockHeader(header);
			await fixOrphans(header.hash.string);
		}
	}
}

async function fixOrphans(hash: string) {
	const height = heights[hash];
	const deps = Object.values(orphans).filter(x => x.prevHash.string == hash);
	for (var d = 0; d < deps.length; d++) {
		const header = deps[d];
		heights[header.hash.string] = height + 1;
		header.height = height + 1;
		await forEachBlockHeader(header);
		delete orphans[header.hash.string];
		await fixOrphans(header.hash.string);
	}
}

async function parseTX(r: BufferReader, buf: Buffer): Promise<TX> {
	const offset = r.tell();
	const version = r.nextUInt32LE();
	const segwit = r.nextUInt16LE() == 256;
	if (!segwit) {
		r.move(-2);
	}
	const inputs = nextVarUIntLE(r);
	const vin: TXin[] = [];
	for (var i = 0; i < inputs; i++) {
		const txid = new Hash(r.nextBuffer(32));
		const vout = r.nextUInt32LE();
		const sigScript = nextVarLengthBuffer(r);
		const sequence = r.nextUInt32LE();
		vin.push({
			txid,
			vout,
			sigScript,
			sequence,
			witness: []
		});
	}
	const outputs = nextVarUIntLE(r);
	const vout: TXout[] = [];
	for (var i = 0; i < outputs; i++) {
		const amount = r.nextBuffer(8).readBigInt64LE();
		const scriptPubKey = nextVarLengthBuffer(r);
		vout.push({
			amount,
			scriptPubKey
		});
	}
	const witnessStart = r.tell();
	if (segwit) {
		for (var i = 0; i < inputs; i++) {
			const elems = nextVarUIntLE(r);
			for (var e = 0; e < elems; e++) {
				const elem = nextVarLengthBuffer(r);
				vin[i].witness.push(elem);
			}
		}
	}
	const witnessLength = r.tell() - witnessStart;
	const locktime = r.nextUInt32LE();
	const length = r.tell() - offset;
	r.seek(offset);
	const txData = r.nextBuffer(length);
	var txDataTxid = txData;
	if (segwit) {
		txDataTxid = Buffer.allocUnsafe(length - 2 - witnessLength);
		// copy begin (version)
		buf.copy(txDataTxid, 0, offset, offset + 4);
		// copy in+out
		buf.copy(txDataTxid, 4, offset + 6, witnessStart);
		// copy end (locktime)
		buf.copy(txDataTxid, witnessStart - offset - 2, r.tell() - 4, r.tell());
	}
	const tx: TX = {
		version,
		segwit,
		vin,
		vout,
		locktime,
		txid: Hash.fromData(txDataTxid),
		hash: Hash.fromData(txData),
		raw: txData,
		rawLegacy: txDataTxid
	};
	return tx;
}
