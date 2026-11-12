// Prisma คืนค่า BIGINT เป็น BigInt ซึ่ง JSON.stringify ไม่รู้จัก -> แปลงเป็นสตริงให้อัตโนมัติ
BigInt.prototype.toJSON = function toJSON() {
  return this.toString();
};
