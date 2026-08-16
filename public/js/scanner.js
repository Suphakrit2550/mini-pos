// ไฟล์นี้ทำหน้าที่: ตัวช่วยเปิดกล้องสแกนบาร์โค้ด ใช้ร่วมกันได้ทุกหน้า
// (สร้างจาก library html5-qrcode ที่แปะไว้ใน public/vendor/)
// - สร้างหน้าต่าง (modal) สแกนบาร์โค้ดขึ้นมาเองอัตโนมัติ ไม่ต้องเขียน HTML เพิ่ม
// - เรียกใช้งานง่ายๆ ด้วย Scanner.open({ onScan, continuous }) แล้วปิดด้วย Scanner.close()
//   - continuous: false = สแกนได้ทีเดียวแล้วปิดกล้องเอง, true = สแกนต่อเนื่องได้เรื่อยๆ
const Scanner = (() => {
  let html5Qrcode = null;
  let onDetect = null;
  let scanning = false;
  let lastCode = null;
  let lastTime = 0;

  function ensureModal() {
    if (document.getElementById('scannerModal')) return;
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="modal-backdrop hidden" id="scannerModal">
        <div class="scanner-box">
          <div class="scanner-header">
            <span>สแกนบาร์โค้ด</span>
            <button type="button" class="btn btn-ghost" id="scannerCloseBtn">ปิด</button>
          </div>
          <div id="scannerViewport"></div>
          <p class="scanner-hint" id="scannerHint">เล็งกล้องไปที่บาร์โค้ดสินค้า</p>
        </div>
      </div>
    `;
    document.body.appendChild(el.firstElementChild);
    document.getElementById('scannerCloseBtn').addEventListener('click', () => Scanner.close());
  }

  function setHint(text) {
    const hint = document.getElementById('scannerHint');
    if (hint) hint.textContent = text;
  }

  async function open({ onScan, continuous = false }) {
    ensureModal();
    onDetect = onScan;
    lastCode = null;
    lastTime = 0;
    document.getElementById('scannerModal').classList.remove('hidden');
    setHint('ถือห่างจากบาร์โค้ดสัก 10-15 ซม. ให้กล้องโฟกัสได้');

    if (typeof Html5Qrcode === 'undefined') {
      showToast('โหลดตัวสแกนบาร์โค้ดไม่สำเร็จ');
      close();
      return;
    }

    html5Qrcode = new Html5Qrcode('scannerViewport', { verbose: false });
    const config = {
      fps: 10,
      qrbox: { width: 280, height: 160 },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
    };

    try {
      await html5Qrcode.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          const now = Date.now();
          if (decodedText === lastCode && now - lastTime < 1500) return;
          lastCode = decodedText;
          lastTime = now;

          if (onDetect) onDetect(decodedText);
          if (continuous) {
            setHint(`สแกนแล้ว: ${decodedText}`);
            setTimeout(() => setHint('เล็งกล้องไปที่บาร์โค้ดสินค้า'), 1200);
          } else {
            close();
          }
        },
        () => {}
      );
      scanning = true;

      // Some Android cameras default to a single fixed focus taken when the
      // stream opens instead of refocusing as the phone moves — asking for
      // continuous autofocus fixes the "blurry once I get close" symptom.
      // Unsupported almost everywhere else (notably iOS Safari, which never
      // exposes focus control to web pages), so this is best-effort: an
      // unsupported constraint here is dropped silently per spec, and the
      // try/catch covers browsers that throw instead of ignoring it.
      try {
        await html5Qrcode.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch (e) {
        // ignore — camera doesn't support runtime focus control
      }
    } catch (err) {
      showToast('เปิดกล้องไม่สำเร็จ: ' + (err.message || err));
      close();
    }
  }

  async function close() {
    const modal = document.getElementById('scannerModal');
    if (modal) modal.classList.add('hidden');
    if (html5Qrcode && scanning) {
      try {
        await html5Qrcode.stop();
        html5Qrcode.clear();
      } catch (e) {
        // ignore — camera may already be stopped
      }
    }
    scanning = false;
    html5Qrcode = null;
    onDetect = null;
  }

  return { open, close };
})();
