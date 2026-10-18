/** vitest：match-identity 全部 *.test.mjs 参与 npm test / CI */
export default {
  test: {
    exclude: ["**/node_modules/**"],
  },
};
