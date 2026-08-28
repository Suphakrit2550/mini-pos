// ไฟล์นี้ทำหน้าที่: เชื่อมต่อและพิมพ์ใบเสร็จผ่านเครื่องพิมพ์ Bluetooth (BLE) แบบ ESC/POS
// - ใช้ Web Bluetooth API — รองรับเฉพาะ Chrome/Edge บน Android หรือคอมพิวเตอร์
//   (Safari/iOS ไม่รองรับ Web Bluetooth เลย ไม่มีทางเลี่ยงจากฝั่งเว็บ)
// - เครื่องพิมพ์ BLE ราคาประหยัดทั่วไปมักใช้ service/characteristic UUID ชุดใดชุดหนึ่งใน
//   BT_CANDIDATES ด้านล่าง จึงไล่ลองทีละคู่ ถ้ารุ่นที่ใช้ไม่ตรงกับ UUID เหล่านี้จะเชื่อมต่อไม่ได้
// - พิมพ์ด้วยการส่งภาพ raster (ESC/POS "GS v 0") แทนการส่งตัวอักษรตรงๆ เพื่อเลี่ยงปัญหา
//   เครื่องพิมพ์ไม่รองรับฟอนต์/ชุดรหัสภาษาไทย (ดู renderReceiptToCanvas ใน receipt.js)

const BT_CANDIDATES = [
  ['000018f0-0000-1000-8000-00805f9b34fb', '00002af1-0000-1000-8000-00805f9b34fb'],
  ['0000ffe0-0000-1000-8000-00805f9b34fb', '0000ffe1-0000-1000-8000-00805f9b34fb'],
  ['6e400001-b5a3-f393-e0a9-e50e24dcca9e', '6e400002-b5a3-f393-e0a9-e50e24dcca9e'],
];

const btPrinter = {
  device: null,
  characteristic: null,

  async connect() {
    if (!window.isSecureContext) {
      throw new Error('ต้องเปิดหน้านี้ผ่าน HTTPS ถึงจะใช้ Bluetooth ได้');
    }
    if (!navigator.bluetooth) {
      throw new Error('เบราว์เซอร์นี้ไม่รองรับ Bluetooth (ใช้ Chrome บน Android เท่านั้น)');
    }

    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BT_CANDIDATES.map(c => c[0]),
      });
    } catch (err) {
      throw err.name === 'NotFoundError' ? new Error('ไม่ได้เลือกเครื่องพิมพ์') : err;
    }

    const server = await device.gatt.connect();

    let characteristic = null;
    for (const [serviceUuid, charUuid] of BT_CANDIDATES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        characteristic = await service.getCharacteristic(charUuid);
        break;
      } catch {
        // ไม่พบ service/characteristic คู่นี้ ลองคู่ถัดไป
      }
    }

    if (!characteristic) {
      device.gatt.disconnect();
      throw new Error('เชื่อมต่อได้แต่ไม่พบช่องทางพิมพ์ที่รู้จัก (เครื่องพิมพ์รุ่นนี้อาจใช้ UUID อื่น)');
    }

    this.device = device;
    this.characteristic = characteristic;
  },

  async ensureConnected() {
    if (this.device && this.device.gatt.connected && this.characteristic) return;
    await this.connect();
  },

  // ส่งข้อมูลเป็นก้อนเล็กๆ ตามขนาดที่ลิงก์ BLE รับได้จริง — เริ่มจากก้อนใหญ่เพื่อความเร็ว
  // แล้วลดขนาดลงอัตโนมัติถ้าส่งไม่ผ่าน (เครื่องพิมพ์ราคาประหยัดมักรับก้อนใหญ่ไม่ได้)
  async writeBytes(bytes) {
    let chunkSize = 180;
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      try {
        if (this.characteristic.writeValueWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else {
          await this.characteristic.writeValue(chunk);
        }
        offset += chunk.length;
      } catch (err) {
        if (chunkSize <= 20) throw err;
        chunkSize = Math.max(20, Math.floor(chunkSize / 2));
      }
    }
  },

  async printCanvas(canvas) {
    await this.ensureConnected();
    await this.writeBytes(canvasToEscPos(canvas));
  },
};

function canvasToEscPos(canvas) {
  const widthPx = canvas.width;
  const heightPx = canvas.height;
  const widthBytes = widthPx / 8;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, widthPx, heightPx);

  const bitmap = new Uint8Array(widthBytes * heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (data[i + 3] > 128 && luminance < 200) {
        bitmap[y * widthBytes + Math.floor(x / 8)] |= 0x80 >> x % 8;
      }
    }
  }

  const chunks = [new Uint8Array([0x1b, 0x40])]; // ESC @ (initialize)

  // แบ่งภาพเป็นแถบๆ ละ 64 บรรทัด กันเครื่องพิมพ์ที่มีบัฟเฟอร์เล็กพิมพ์ภาพยาวๆ ไม่ได้
  const BAND_ROWS = 64;
  for (let y = 0; y < heightPx; y += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, heightPx - y);
    chunks.push(new Uint8Array([
      0x1d, 0x76, 0x30, 0x00,
      widthBytes & 0xff, (widthBytes >> 8) & 0xff,
      rows & 0xff, (rows >> 8) & 0xff,
    ]));
    chunks.push(bitmap.subarray(y * widthBytes, (y + rows) * widthBytes));
  }

  chunks.push(new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a])); // ป้อนกระดาษเผื่อฉีก

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
