import type { Request, RequestHandler, Response } from "express";

/** Forward both synchronous throws and rejected promises to Express 4. */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  };
}
