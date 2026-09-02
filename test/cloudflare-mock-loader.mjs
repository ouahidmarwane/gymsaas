// Cloudflare Workers test mock loader
// Provides mocks for Cloudflare Worker APIs needed for local testing
export async function resolve(specifier, context, nextResolve) {
  // Handle Cloudflare Durable Object storage mocks
  if (specifier === 'cloudflare:workers') {
    // Return a mock for cloudflare:workers module
    return {
      url: 'cloudflare:workers',
      format: 'module',
      source: `
        // Mock Durable Object storage interfaces
        export class DurableObjectStorage {
          constructor() {
            this._sql = null;
          }

          get sql() {
            if (!this._sql) {
              // This will be set by the test setup
              throw new Error('DurableObjectStorage.sql not initialized');
            }
            return this._sql;
          }

          set sql(value) {
            this._sql = value;
          }

          async transactionSync(callback) {
            return callback();
          }
        }

        export class DurableObjectState {
          constructor() {
            this.storage = new DurableObjectStorage();
            this.blockConcurrencyWhile = async (callback) => {
              return await callback();
            };
          }
        }

        // Mock ctx object
        export const ctx = {
          storage: new DurableObjectStorage()
        };
      `
    };
  }

  // Handle Node built-in modules normally
  if (specifier.startsWith('node:')) {
    return nextResolve(specifier, context);
  }

  // Handle relative and absolute paths normally (let TypeScript handle .ts extensions)
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
    return nextResolve(specifier, context);
  }

  // For everything else, use normal resolution
  return nextResolve(specifier, context);
}