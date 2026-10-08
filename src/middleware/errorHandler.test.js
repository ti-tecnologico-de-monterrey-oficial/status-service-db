import { expect } from 'chai';
import sinon from 'sinon';
import errorHandler from './errorHandler.js';

describe('errorHandler middleware', () => {
  it('responds with the error code, message, and json content-type', () => {
    const error = { code: 404, message: 'Not found' };
    const headerSpy = sinon.spy();
    const jsonSpy = sinon.spy();
    const statusStub = sinon.stub().returns({ json: jsonSpy });
    const response = { header: headerSpy, status: statusStub };
    const next = sinon.spy();

    errorHandler(error, {}, response, next);

    expect(headerSpy.calledOnceWith('Content-Type', 'application/json')).to.be.true;
    expect(statusStub.calledOnceWith(404)).to.be.true;
    expect(jsonSpy.calledOnce).to.be.true;
    const payload = jsonSpy.firstCall.args[0];
    expect(payload.code).to.equal(404);
    expect(payload.message).to.contain('Not found');
  });

  it('includes a fallback unknown error message when the error has no message', () => {
    const error = { code: 500 };
    const jsonSpy = sinon.spy();
    const statusStub = sinon.stub().returns({ json: jsonSpy });
    const response = { header: sinon.spy(), status: statusStub };

    errorHandler(error, {}, response, sinon.spy());

    const payload = jsonSpy.firstCall.args[0];
    expect(payload.message).to.contain('unknown error.');
  });
});
