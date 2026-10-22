import { describe, expect, it, vi } from 'vitest';
import errorHandler from './errorHandler.js';

function fakeResponse() {
  const response = {
    header: vi.fn(),
    status: vi.fn(() => response),
    json: vi.fn(() => response)
  };
  return response;
}

describe('errorHandler', () => {
  it('responds with the HTTP status carried by the error', () => {
    const response = fakeResponse();

    errorHandler({ code: 404, message: 'not found' }, {}, response);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 404 }));
    expect(response.json.mock.calls[0][0].message).toContain('not found');
    expect(response.header).toHaveBeenCalledWith('Content-Type', 'application/json');
  });

  it.each([
    ['a MongoDB duplicate key', 11000],
    ['a MongoDB write conflict', 112],
    ['a missing code', undefined],
    ['a non numeric code', 'ECONNRESET']
  ])('answers 500 for %s', (_, code) => {
    const response = fakeResponse();

    errorHandler({ code, message: 'boom' }, {}, response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 500 }));
  });

  it('says unknown error when the error has no message', () => {
    const response = fakeResponse();

    errorHandler({ code: 500 }, {}, response);

    expect(response.json.mock.calls[0][0].message).toContain('unknown error.');
  });
});
