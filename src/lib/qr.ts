import 'server-only'
import QRCode from 'qrcode'

// P4-11: encode the PUBLIC share URL. `H` correction survives WeChat's image recompression.
// qrcode ships CJS; `import QRCode from 'qrcode'` works in App Router server code.
export function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'H', width: 220, margin: 1 })
}
