import { BaseAdapter } from "../base-adapter.js";

export class MockAdapter extends BaseAdapter {
  constructor() {
    super(
      "mock-driver",
      "Mock Driver (Subprocess)",
      "In-memory / subprocess mock driver for testing and verification",
      "acp",
      "node",
      ["dist/src/driver/mock-driver.js"],
      "none"
    );
  }
}
