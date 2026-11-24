export class JobQueue {
    constructor(concurrency = 2, maxWaiting = 12) {
        this.concurrency = concurrency; this.maxWaiting = maxWaiting; this.active = 0; this.waiting = [];
    }
    run(fn) {
        if (this.active >= this.concurrency && this.waiting.length >= this.maxWaiting) return Promise.reject(new Error('El bot está ocupado. Intenta nuevamente.'));
        return new Promise((resolve, reject) => {
            this.waiting.push({ fn, resolve, reject }); this.drain();
        });
    }
    drain() {
        while (this.active < this.concurrency && this.waiting.length) {
            const { fn, resolve, reject } = this.waiting.shift();
            this.active++;
            Promise.resolve().then(fn).then(resolve, reject).finally(() => { this.active--; this.drain(); });
        }
    }
}
