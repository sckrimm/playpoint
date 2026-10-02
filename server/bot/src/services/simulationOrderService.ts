import type { SimulatedOrderResult } from "../types/strategy.js";

export class SimulationOrderService {
  readonly environment = "SIMULATION" as const;
  private sequence = 0;

  async buy(symbol: string, price: number, quoteAmount: number): Promise<SimulatedOrderResult> {
    if (price <= 0 || quoteAmount <= 0) throw new Error("Simulation order values must be positive");
    const assetQuantity = quoteAmount / price;
    this.sequence += 1;
    return {
      orderId: `SIM-${Date.now()}-${this.sequence}`,
      symbol,
      side: "BUY",
      price,
      quoteAmount,
      assetQuantity,
    };
  }

  async sell(symbol: string, price: number, assetQuantity: number): Promise<SimulatedOrderResult> {
    if (price <= 0 || assetQuantity <= 0) throw new Error("Simulation order values must be positive");
    this.sequence += 1;
    return {
      orderId: `SIM-${Date.now()}-${this.sequence}`,
      symbol,
      side: "SELL",
      price,
      quoteAmount: assetQuantity * price,
      assetQuantity,
    };
  }
}
