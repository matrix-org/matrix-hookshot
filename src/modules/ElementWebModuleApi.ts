import { Router } from "express";

export const elementWebModuleRouter = Router();

elementWebModuleRouter.get(
  "/modules/v2/static/openproject.js",
  (_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.sendFile(
      "modules/openproject/element-web/index.js",
      { root: "public" },
      (error) => {
        if (error) {
          next(error);
        }
      },
    );
  },
);
