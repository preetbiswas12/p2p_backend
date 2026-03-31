/// <reference lib="dom" />
/// <reference lib="es2020" />

declare global {
	namespace NodeJS {
		interface ProcessEnv {
			PORT?: string;
			SIGNALING_PORT?: string;
			NODE_ENV?: string;
		}
	}

	var process: NodeJS.Process;
	var console: Console;
	var Buffer: BufferConstructor;
}

interface BufferConstructor {
	from(arrayBuffer: ArrayBuffer, byteOffset?: number, length?: number): Buffer;
	from(data: Uint8Array | readonly number[]): Buffer;
	from(data: string, encoding?: BufferEncoding): Buffer;
	alloc(size: number, fill?: string | Buffer | number, encoding?: BufferEncoding): Buffer;
	allocUnsafe(size: number): Buffer;
	concat(list: readonly Uint8Array[], totalLength?: number): Buffer;
	isBuffer(obj: any): obj is Buffer;
	isEncoding(encoding: string): encoding is BufferEncoding;
	byteLength(string: string | NodeJS.ArrayBufferView | ArrayBuffer, encoding?: string): number;
	compare(buf1: Uint8Array, buf2: Uint8Array): number;
}

interface Buffer extends Uint8Array {
	toString(encoding?: BufferEncoding, start?: number, end?: number): string;
	toJSON(): { type: 'Buffer'; data: number[] };
	write(string: string, offset?: number, length?: number, encoding?: BufferEncoding): number;
}

type BufferEncoding = 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'ucs-2' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex';

export {};
