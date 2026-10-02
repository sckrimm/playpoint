export const money = (value: number): string => `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const quantity = (value: number): string => value.toLocaleString("en-US", { maximumFractionDigits: 8 });
