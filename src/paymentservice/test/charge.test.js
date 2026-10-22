const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const charge = require('../charge');

const VISA = '4432-8015-6152-0454';
const MASTERCARD = '5555555555554444';
const AMEX = '378282246310005';

const now = new Date();
const CURRENT_YEAR = now.getFullYear();
const CURRENT_MONTH = now.getMonth() + 1;

function request ({
  number = VISA,
  year = CURRENT_YEAR + 1,
  month = 1
} = {}) {
  return {
    amount: { currency_code: 'USD', units: 42, nanos: 500000000 },
    credit_card: {
      credit_card_number: number,
      credit_card_cvv: 123,
      credit_card_expiration_year: year,
      credit_card_expiration_month: month
    }
  };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('charge', () => {
  describe('accepted cards', () => {
    test('charges a valid VISA card and returns a v4 uuid transaction id', () => {
      const { transaction_id: id } = charge(request({ number: VISA }));
      assert.match(id, UUID_V4);
    });

    test('charges a valid MasterCard', () => {
      const { transaction_id: id } = charge(request({ number: MASTERCARD }));
      assert.match(id, UUID_V4);
    });

    test('returns a unique transaction id per charge', () => {
      const a = charge(request()).transaction_id;
      const b = charge(request()).transaction_id;
      assert.notEqual(a, b);
    });

    test('accepts a card that expires in the current month', () => {
      assert.doesNotThrow(() => charge(request({ year: CURRENT_YEAR, month: CURRENT_MONTH })));
    });
  });

  describe('invalid cards', () => {
    for (const [label, number] of [
      ['a number failing the Luhn check', '4432801561520455'],
      ['a too-short number', '1234'],
      ['an empty number', ''],
      ['a missing number', undefined]
    ]) {
      test(`rejects ${label} with InvalidCreditCard (code 400)`, () => {
        const req = request();
        req.credit_card.credit_card_number = number;
        assert.throws(() => charge(req), (err) => {
          assert.ok(err instanceof Error);
          assert.equal(err.code, 400);
          assert.equal(err.message, 'Credit card info is invalid');
          return true;
        });
      });
    }
  });

  describe('unaccepted card types', () => {
    test('rejects a valid AMEX card with UnacceptedCreditCard (code 400)', () => {
      assert.throws(() => charge(request({ number: AMEX })), (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.code, 400);
        assert.equal(
          err.message,
          'Sorry, we cannot process amex credit cards. Only VISA or MasterCard is accepted.'
        );
        return true;
      });
    });
  });

  describe('expired cards', () => {
    test('rejects a card that expired last year', () => {
      assert.throws(() => charge(request({ year: CURRENT_YEAR - 1, month: 12 })), (err) => {
        assert.equal(err.code, 400);
        assert.equal(
          err.message,
          `Your credit card (ending 0454) expired on 12/${CURRENT_YEAR - 1}`
        );
        return true;
      });
    });

    test('rejects a card that expired last month', () => {
      const prev = new Date(CURRENT_YEAR, CURRENT_MONTH - 2, 1);
      const year = prev.getFullYear();
      const month = prev.getMonth() + 1;
      assert.throws(() => charge(request({ number: MASTERCARD, year, month })), (err) => {
        assert.equal(err.code, 400);
        assert.equal(err.message, `Your credit card (ending 4444) expired on ${month}/${year}`);
        return true;
      });
    });

    test('checks card validity before expiration', () => {
      assert.throws(
        () => charge(request({ number: '1234', year: CURRENT_YEAR - 1 })),
        { message: 'Credit card info is invalid' }
      );
    });
  });
});
