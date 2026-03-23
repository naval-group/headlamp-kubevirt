import { Dialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { DialogProps } from '@mui/material';
import { Alert, Box, Typography } from '@mui/material';
import DialogContent from '@mui/material/DialogContent';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RFBPixelFormat } from '../../types';
import VirtualMachineInstance from '../VirtualMachineInstance/VirtualMachineInstance';

interface VNCProps extends DialogProps {
  item: VirtualMachineInstance;
  onClose?: () => void;
  open: boolean;
}

// Map browser KeyboardEvent to X11 keysym
function getKeysym(e: React.KeyboardEvent): number | null {
  // Special keys
  const specialKeys: { [key: string]: number } = {
    Backspace: 0xff08,
    Tab: 0xff09,
    Enter: 0xff0d,
    Escape: 0xff1b,
    Delete: 0xffff,
    Home: 0xff50,
    End: 0xff57,
    PageUp: 0xff55,
    PageDown: 0xff56,
    ArrowLeft: 0xff51,
    ArrowUp: 0xff52,
    ArrowRight: 0xff53,
    ArrowDown: 0xff54,
    Shift: 0xffe1,
    Control: 0xffe3,
    Alt: 0xffe9,
    Meta: 0xffe7,
    F1: 0xffbe,
    F2: 0xffbf,
    F3: 0xffc0,
    F4: 0xffc1,
    F5: 0xffc2,
    F6: 0xffc3,
    F7: 0xffc4,
    F8: 0xffc5,
    F9: 0xffc6,
    F10: 0xffc7,
    F11: 0xffc8,
    F12: 0xffc9,
  };

  if (e.key in specialKeys) {
    return specialKeys[e.key];
  }

  // Dead keys (accents like ^, `, ¨, ~)
  // On French keyboard, ^ is at the same position as [ on US keyboard
  if (e.key === 'Dead') {
    // Try to detect which dead key based on e.code
    const deadKeyMap: { [code: string]: number } = {
      BracketLeft: 0x5e, // ^ (circumflex) - same physical key as [ on US
      Quote: 0xb4, // ´ (acute accent)
      Backquote: 0x60, // ` (grave accent)
    };

    if (e.code && e.code in deadKeyMap) {
      return deadKeyMap[e.code];
    }

    return null;
  }

  // Regular characters - use charCode
  if (e.key.length === 1) {
    const keysym = e.key.charCodeAt(0);
    return keysym;
  }

  return null;
}

export default function VNC(props: VNCProps) {
  const { item, onClose, ...other } = props;
  useTranslation(['translation', 'glossary']);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [framebufferSize, setFramebufferSize] = useState<{ width: number; height: number } | null>(
    null
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vncRef = useRef<any>(null);

  // Set canvas dimensions when both canvas ref and framebuffer size are available
  useEffect(() => {
    if (canvasRef.current && framebufferSize) {
      canvasRef.current.width = framebufferSize.width;
      canvasRef.current.height = framebufferSize.height;
    }
  }, [framebufferSize, connectionStatus]);

  useEffect(() => {
    // Don't do anything if the dialog is not open
    if (!props.open) {
      return;
    }

    // Clean up any existing VNC connection
    if (vncRef.current) {
      vncRef.current.cancel();
      vncRef.current = null;
    }

    setConnectionStatus('connecting');
    setErrorMessage('');

    let rfbState = 'ProtocolVersion';
    const decoder = new TextDecoder('latin1');
    const encoder = new TextEncoder();
    let fbWidth = 0;
    let fbHeight = 0;
    let pixelFormat: RFBPixelFormat | null = null;
    let buffer = new Uint8Array(0);

    function appendBuffer(newData: Uint8Array) {
      const combined = new Uint8Array(buffer.length + newData.length);
      combined.set(buffer);
      combined.set(newData, buffer.length);
      buffer = combined;
    }

    function consumeBuffer(length: number): Uint8Array | null {
      if (buffer.length < length) return null;
      const consumed = buffer.slice(0, length);
      buffer = buffer.slice(length);
      return consumed;
    }

    (async function () {
      try {
        vncRef.current = await item.vnc(
          (data: ArrayBuffer) => {
            const bytes = new Uint8Array(data);
            appendBuffer(bytes);

            // Process buffer based on current state
            while (true) {
              if (rfbState === 'ProtocolVersion') {
                const msg = consumeBuffer(12);
                if (!msg) break;
                decoder.decode(msg); // consume version string
                // Respond with same version
                const response = 'RFB 003.008\n';
                const socket = vncRef.current?.getSocket();
                if (socket && socket.readyState === 1) {
                  const encoded = encoder.encode(response);
                  socket.send(encoded);
                  rfbState = 'Security';
                }
              } else if (rfbState === 'Security') {
                if (buffer.length < 1) break;
                const numTypes = buffer[0];
                const msg = consumeBuffer(1 + numTypes);
                if (!msg) break;
                if (numTypes > 0) {
                  const types = Array.from(msg.slice(1));
                  // Choose type 1 (None) if available
                  if (types.includes(1)) {
                    const socket = vncRef.current?.getSocket();
                    if (socket && socket.readyState === 1) {
                      socket.send(new Uint8Array([1]));
                      rfbState = 'SecurityResult';
                    }
                  }
                }
              } else if (rfbState === 'SecurityResult') {
                const msg = consumeBuffer(4);
                if (!msg) break;
                const resultCode = new DataView(msg.buffer, msg.byteOffset).getUint32(0);
                if (resultCode !== 0) {
                  setConnectionStatus('disconnected');
                  setErrorMessage('VNC authentication failed.');
                  break;
                }
                // Send ClientInit (1 byte: 1 = shared)
                const socket = vncRef.current?.getSocket();
                if (socket && socket.readyState === 1) {
                  socket.send(new Uint8Array([1]));
                  rfbState = 'ServerInit';
                }
              } else if (rfbState === 'ServerInit') {
                if (buffer.length < 24) break;
                // Read name length to know total message size
                const view = new DataView(buffer.buffer, buffer.byteOffset);
                const nameLength = view.getUint32(20);
                const totalLength = 24 + nameLength;
                const msg = consumeBuffer(totalLength);
                if (!msg) break;

                const msgView = new DataView(msg.buffer, msg.byteOffset);
                fbWidth = msgView.getUint16(0);
                fbHeight = msgView.getUint16(2);

                // Parse pixel format (bytes 4-19)
                pixelFormat = {
                  bitsPerPixel: msgView.getUint8(4),
                  depth: msgView.getUint8(5),
                  bigEndian: msgView.getUint8(6) !== 0,
                  trueColor: msgView.getUint8(7) !== 0,
                  redMax: msgView.getUint16(8),
                  greenMax: msgView.getUint16(10),
                  blueMax: msgView.getUint16(12),
                  redShift: msgView.getUint8(14),
                  greenShift: msgView.getUint8(15),
                  blueShift: msgView.getUint8(16),
                };

                // Store framebuffer size - canvas will be set up by useEffect
                setFramebufferSize({ width: fbWidth, height: fbHeight });
                setConnectionStatus('connected');
                rfbState = 'Normal';

                // Send SetEncodings message (support Raw encoding: 0)
                const socket = vncRef.current?.getSocket();
                if (socket && socket.readyState === 1) {
                  const encodingsMsg = new Uint8Array(8);
                  encodingsMsg[0] = 2; // SetEncodings message type
                  encodingsMsg[1] = 0; // padding
                  encodingsMsg[2] = 0;
                  encodingsMsg[3] = 1; // 1 encoding
                  encodingsMsg[4] = 0;
                  encodingsMsg[5] = 0;
                  encodingsMsg[6] = 0;
                  encodingsMsg[7] = 0; // Raw encoding = 0
                  socket.send(encodingsMsg);

                  // Request full framebuffer update
                  const updateMsg = new Uint8Array(10);
                  updateMsg[0] = 3; // FramebufferUpdateRequest message type
                  updateMsg[1] = 0; // incremental = 0 (full update)
                  updateMsg[2] = 0;
                  updateMsg[3] = 0;
                  updateMsg[4] = 0;
                  updateMsg[5] = 0;
                  updateMsg[6] = (fbWidth >> 8) & 0xff;
                  updateMsg[7] = fbWidth & 0xff;
                  updateMsg[8] = (fbHeight >> 8) & 0xff;
                  updateMsg[9] = fbHeight & 0xff;
                  socket.send(updateMsg);
                }
              } else if (rfbState === 'Normal') {
                // Normal state - receiving framebuffer updates
                if (buffer.length < 4) break;
                if (buffer[0] === 0) {
                  // FramebufferUpdate message
                  const view = new DataView(buffer.buffer, buffer.byteOffset);
                  const numRects = view.getUint16(2);

                  // Calculate required size for all rectangles
                  let requiredSize = 4; // header
                  let offset = 4;

                  for (let i = 0; i < numRects; i++) {
                    if (buffer.length < offset + 12) {
                      // Need more data for rectangle header
                      return; // Wait for more data
                    }
                    const w = view.getUint16(offset + 4);
                    const h = view.getUint16(offset + 6);
                    const encoding = view.getInt32(offset + 8);

                    requiredSize = offset + 12;
                    if (encoding === 0) {
                      const bytesPerPixel = pixelFormat.bitsPerPixel / 8;
                      requiredSize += w * h * bytesPerPixel;
                    }
                    offset = requiredSize;
                  }

                  // Wait until we have all the data
                  if (buffer.length < requiredSize) {
                    break;
                  }

                  const msg = consumeBuffer(requiredSize);
                  if (!msg) break;

                  const msgView = new DataView(msg.buffer, msg.byteOffset);
                  offset = 4;

                  for (let i = 0; i < numRects; i++) {
                    const x = msgView.getUint16(offset);
                    const y = msgView.getUint16(offset + 2);
                    const w = msgView.getUint16(offset + 4);
                    const h = msgView.getUint16(offset + 6);
                    const encoding = msgView.getInt32(offset + 8);
                    offset += 12;

                    if (encoding === 0 && canvasRef.current) {
                      // Raw encoding - pixel data follows
                      const bytesPerPixel = pixelFormat.bitsPerPixel / 8;
                      const ctx = canvasRef.current.getContext('2d');
                      if (ctx) {
                        const imageData = ctx.createImageData(w, h);

                        // Convert pixel data to RGBA
                        for (let py = 0; py < h; py++) {
                          for (let px = 0; px < w; px++) {
                            const pixelOffset = offset + (py * w + px) * bytesPerPixel;
                            const imgOffset = (py * w + px) * 4;

                            // Read pixel based on format (assuming 32bpp RGBA)
                            if (bytesPerPixel === 4) {
                              imageData.data[imgOffset + 0] = msg[pixelOffset + 2]; // R
                              imageData.data[imgOffset + 1] = msg[pixelOffset + 1]; // G
                              imageData.data[imgOffset + 2] = msg[pixelOffset + 0]; // B
                              imageData.data[imgOffset + 3] = 255; // A
                            }
                          }
                        }

                        ctx.putImageData(imageData, x, y);
                      }

                      offset += w * h * bytesPerPixel;
                    }
                  }

                  // Request incremental update
                  const socket = vncRef.current?.getSocket();
                  if (socket && socket.readyState === 1) {
                    const updateMsg = new Uint8Array(10);
                    updateMsg[0] = 3; // FramebufferUpdateRequest
                    updateMsg[1] = 1; // incremental = 1
                    updateMsg[2] = 0;
                    updateMsg[3] = 0;
                    updateMsg[4] = 0;
                    updateMsg[5] = 0;
                    updateMsg[6] = (fbWidth >> 8) & 0xff;
                    updateMsg[7] = fbWidth & 0xff;
                    updateMsg[8] = (fbHeight >> 8) & 0xff;
                    updateMsg[9] = fbHeight & 0xff;
                    socket.send(updateMsg);
                  }
                } else {
                  // Consume unknown message (just skip it for now)
                  consumeBuffer(1);
                }
              } else {
                // Unknown state, exit loop
                break;
              }
            }
          },
          {
            reconnectOnFailure: false,
            connectCb: () => {},
            failCb: () => {
              setConnectionStatus('disconnected');
              setErrorMessage('VNC connection failed. Check console for details.');
            },
          }
        );
      } catch (error) {
        setConnectionStatus('disconnected');
        setErrorMessage(`Failed to create VNC connection: ${error}`);
      }
    })();

    return function cleanup() {
      if (vncRef.current) {
        vncRef.current.cancel();
        vncRef.current = null;
      }
    };
  }, [props.open, item]);

  return (
    <Dialog
      onClose={onClose}
      withFullScreen
      title={
        (
          <Box display="flex" alignItems="center" gap={1}>
            <span>VNC: {item.getName()}</span>
            <Box
              component="span"
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor:
                  connectionStatus === 'connected'
                    ? '#4caf50'
                    : connectionStatus === 'connecting'
                    ? '#ff9800'
                    : '#f44336',
                display: 'inline-block',
              }}
            />
          </Box>
        ) as unknown as string
      }
      {...other}
    >
      <DialogContent
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          backgroundColor: '#000',
        }}
      >
        {errorMessage && (
          <Alert severity="error" sx={{ m: 2 }}>
            {errorMessage}
          </Alert>
        )}

        {connectionStatus === 'connecting' && !errorMessage && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#fff',
            }}
          >
            <Typography>Connecting to VNC...</Typography>
          </Box>
        )}

        {connectionStatus === 'connected' && (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              width: '100%',
              height: '100%',
              position: 'relative',
            }}
          >
            <canvas
              ref={canvasRef}
              tabIndex={0}
              style={{
                display: 'block',
                imageRendering: 'auto',
                outline: 'none',
                cursor: 'default',
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
              onMouseDown={e => {
                const socket = vncRef.current?.getSocket();
                if (!socket || socket.readyState !== 1) return;

                const canvas = canvasRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();

                // Scale mouse coordinates from display size to actual canvas size
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const x = Math.floor((e.clientX - rect.left) * scaleX);
                const y = Math.floor((e.clientY - rect.top) * scaleY);

                // PointerEvent message: type(1) + button-mask(1) + x(2) + y(2)
                const msg = new Uint8Array(6);
                msg[0] = 5; // PointerEvent message type
                msg[1] = 1 << e.button; // button mask (left=1, middle=2, right=4)
                msg[2] = (x >> 8) & 0xff;
                msg[3] = x & 0xff;
                msg[4] = (y >> 8) & 0xff;
                msg[5] = y & 0xff;
                socket.send(msg);
              }}
              onMouseUp={e => {
                const socket = vncRef.current?.getSocket();
                if (!socket || socket.readyState !== 1) return;

                const canvas = canvasRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();

                // Scale mouse coordinates from display size to actual canvas size
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const x = Math.floor((e.clientX - rect.left) * scaleX);
                const y = Math.floor((e.clientY - rect.top) * scaleY);

                // Release all buttons
                const msg = new Uint8Array(6);
                msg[0] = 5; // PointerEvent message type
                msg[1] = 0; // no buttons pressed
                msg[2] = (x >> 8) & 0xff;
                msg[3] = x & 0xff;
                msg[4] = (y >> 8) & 0xff;
                msg[5] = y & 0xff;
                socket.send(msg);
              }}
              onMouseMove={e => {
                const socket = vncRef.current?.getSocket();
                if (!socket || socket.readyState !== 1) return;

                const canvas = canvasRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();

                // Scale mouse coordinates from display size to actual canvas size
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const x = Math.floor((e.clientX - rect.left) * scaleX);
                const y = Math.floor((e.clientY - rect.top) * scaleY);

                // Send mouse position
                const msg = new Uint8Array(6);
                msg[0] = 5; // PointerEvent message type
                msg[1] = 0; // button mask (no buttons during move)
                msg[2] = (x >> 8) & 0xff;
                msg[3] = x & 0xff;
                msg[4] = (y >> 8) & 0xff;
                msg[5] = y & 0xff;
                socket.send(msg);
              }}
              onKeyDown={e => {
                e.preventDefault();
                const socket = vncRef.current?.getSocket();
                if (!socket || socket.readyState !== 1) return;

                // Helper to send a key event
                const sendKeyEvent = (keysym: number, down: boolean) => {
                  const msg = new Uint8Array(8);
                  msg[0] = 4; // KeyEvent message type
                  msg[1] = down ? 1 : 0; // down-flag
                  msg[2] = 0; // padding
                  msg[3] = 0; // padding
                  msg[4] = (keysym >> 24) & 0xff;
                  msg[5] = (keysym >> 16) & 0xff;
                  msg[6] = (keysym >> 8) & 0xff;
                  msg[7] = keysym & 0xff;
                  socket.send(msg);
                };

                // Check for AltGr (detected as Alt+Ctrl on Windows, or just location === 2 on some browsers)
                const isAltGr = e.getModifierState && e.getModifierState('AltGraph');

                // If AltGr is pressed, send ISO_Level3_Shift first
                if (isAltGr) {
                  sendKeyEvent(0xfe03, true); // ISO_Level3_Shift down
                }

                // Map browser key codes to X11 keysyms
                const keysym = getKeysym(e);
                if (keysym !== null) {
                  sendKeyEvent(keysym, true);
                }
              }}
              onKeyUp={e => {
                e.preventDefault();
                const socket = vncRef.current?.getSocket();
                if (!socket || socket.readyState !== 1) return;

                // Helper to send a key event
                const sendKeyEvent = (keysym: number, down: boolean) => {
                  const msg = new Uint8Array(8);
                  msg[0] = 4; // KeyEvent message type
                  msg[1] = down ? 1 : 0; // down-flag
                  msg[2] = 0; // padding
                  msg[3] = 0; // padding
                  msg[4] = (keysym >> 24) & 0xff;
                  msg[5] = (keysym >> 16) & 0xff;
                  msg[6] = (keysym >> 8) & 0xff;
                  msg[7] = keysym & 0xff;
                  socket.send(msg);
                };

                const keysym = getKeysym(e);
                if (keysym !== null) {
                  sendKeyEvent(keysym, false);
                }

                // Check for AltGr release
                const isAltGr = e.getModifierState && e.getModifierState('AltGraph');

                // If AltGr was pressed, release ISO_Level3_Shift after the key
                if (isAltGr) {
                  sendKeyEvent(0xfe03, false); // ISO_Level3_Shift up
                }
              }}
              onClick={() => {
                // Focus the canvas so it receives keyboard events
                canvasRef.current?.focus();
              }}
            />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
