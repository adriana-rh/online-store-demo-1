const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const grpc = require('@grpc/grpc-js');

const HipsterShopServer = require('../server');

const PROTO_ROOT = path.join(__dirname, '..', 'proto');

function chargeRequest (number) {
  return {
    amount: { currency_code: 'USD', units: 10, nanos: 0 },
    credit_card: {
      credit_card_number: number,
      credit_card_cvv: 123,
      credit_card_expiration_year: new Date().getFullYear() + 1,
      credit_card_expiration_month: 1
    }
  };
}

describe('HipsterShopServer handlers', () => {
  test('ChargeServiceHandler returns a transaction id for a valid card', (t, done) => {
    HipsterShopServer.ChargeServiceHandler(
      { request: chargeRequest('4432-8015-6152-0454') },
      (err, res) => {
        assert.equal(err, null);
        assert.equal(typeof res.transaction_id, 'string');
        done();
      }
    );
  });

  test('ChargeServiceHandler passes charge errors to the callback', (t, done) => {
    t.mock.method(console, 'warn', () => {});
    HipsterShopServer.ChargeServiceHandler(
      { request: chargeRequest('378282246310005') },
      (err, res) => {
        assert.ok(err instanceof Error);
        assert.equal(err.code, 400);
        assert.equal(res, undefined);
        done();
      }
    );
  });

  test('CheckHandler reports SERVING', (t, done) => {
    HipsterShopServer.CheckHandler({}, (err, res) => {
      assert.equal(err, null);
      assert.deepEqual(res, { status: 'SERVING' });
      done();
    });
  });
});

describe('HipsterShopServer over gRPC', () => {
  let shopServer;
  let paymentClient;
  let healthClient;

  before(async () => {
    shopServer = new HipsterShopServer(PROTO_ROOT);
    const port = await new Promise((resolve, reject) => {
      shopServer.server.bindAsync(
        '127.0.0.1:0',
        grpc.ServerCredentials.createInsecure(),
        (err, boundPort) => (err ? reject(err) : resolve(boundPort))
      );
    });
    const address = `127.0.0.1:${port}`;
    const creds = grpc.credentials.createInsecure();
    const { hipstershop } = shopServer.packages.hipsterShop;
    const healthPkg = shopServer.packages.health.grpc.health.v1;
    paymentClient = new hipstershop.PaymentService(address, creds);
    healthClient = new healthPkg.Health(address, creds);
  });

  after(() => {
    paymentClient.close();
    healthClient.close();
    shopServer.server.forceShutdown();
  });

  test('Charge succeeds for a valid VISA card', (t, done) => {
    paymentClient.charge(chargeRequest('4432-8015-6152-0454'), (err, res) => {
      assert.equal(err, null);
      assert.match(res.transaction_id, /^[0-9a-f-]{36}$/);
      done();
    });
  });

  test('Charge returns an error status for an unaccepted card type', (t, done) => {
    t.mock.method(console, 'warn', () => {});
    paymentClient.charge(chargeRequest('378282246310005'), (err) => {
      assert.ok(err);
      assert.match(err.details, /cannot process amex/);
      done();
    });
  });

  test('Charge returns an error status for an empty card number', (t, done) => {
    t.mock.method(console, 'warn', () => {});
    paymentClient.charge(chargeRequest(''), (err) => {
      assert.ok(err);
      assert.equal(err.details, 'Credit card info is invalid');
      done();
    });
  });

  test('Health check reports SERVING', (t, done) => {
    healthClient.check({ service: '' }, (err, res) => {
      assert.equal(err, null);
      assert.equal(res.status, 'SERVING');
      done();
    });
  });
});
