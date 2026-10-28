export interface PhonemeInfo {
  ipa: string
  example: string
  tip: string
}

/** Mouth-position tips per ARPAbet phoneme, written for Vietnamese learners. */
export const PHONEMES: Record<string, PhonemeInfo> = {
  AA: { ipa: 'ɑː', example: 'father, hot', tip: 'Mở miệng rộng, hạ hàm xuống, lưỡi nằm thấp và lùi về sau. Kéo dài hơn "a" tiếng Việt.' },
  AE: { ipa: 'æ', example: 'cat, bad', tip: 'Mở miệng rộng sang hai bên như đang cười, hạ hàm. Âm nằm giữa "a" và "e". Đừng đọc thành "e" (bad ≠ bed).' },
  AH: { ipa: 'ʌ / ə', example: 'cup, about', tip: 'Miệng thả lỏng, mở vừa, giống "ơ/â" ngắn. Ở âm tiết không nhấn thì đọc rất nhẹ và nhanh (schwa /ə/).' },
  AO: { ipa: 'ɔː', example: 'law, thought', tip: 'Tròn môi vừa phải, hàm hạ, kéo dài như "o" tiếng Việt nhưng sâu hơn.' },
  AW: { ipa: 'aʊ', example: 'now, house', tip: 'Bắt đầu bằng "a" mở rộng rồi trượt sang "u" tròn môi: "ao" nhưng có chuyển động rõ.' },
  AY: { ipa: 'aɪ', example: 'my, time', tip: 'Bắt đầu bằng "a" rồi trượt lên "i": giống "ai" tiếng Việt, kéo đủ độ dài.' },
  EH: { ipa: 'e', example: 'bed, red', tip: 'Miệng mở vừa, môi hơi dẹt, giống "e" tiếng Việt nhưng ngắn.' },
  ER: { ipa: 'ɝː / ɚ', example: 'bird, teacher', tip: 'Cong đầu lưỡi lên (không chạm vòm), môi hơi tròn, giữ "ơ" kéo dài kèm âm r. Giọng Anh thì không cong lưỡi.' },
  EY: { ipa: 'eɪ', example: 'day, make', tip: 'Đi từ "e" trượt lên "i": "ây". Đừng đọc thành "e" đơn.' },
  IH: { ipa: 'ɪ', example: 'ship, sit', tip: 'Âm "i" NGẮN, thả lỏng, miệng hơi mở hơn /iː/. Đọc nhanh, gọn (ship ≠ sheep).' },
  IY: { ipa: 'iː', example: 'sheep, see', tip: 'Âm "i" DÀI, căng môi sang hai bên như cười, kéo dài gấp đôi /ɪ/.' },
  OW: { ipa: 'oʊ', example: 'go, home', tip: 'Đi từ "ô" trượt sang "u" tròn môi: "âu". Đừng đọc thành "ô" đơn.' },
  OY: { ipa: 'ɔɪ', example: 'boy, voice', tip: 'Đi từ "o" trượt sang "i": "oi".' },
  UH: { ipa: 'ʊ', example: 'book, good', tip: 'Âm "u" NGẮN, môi tròn nhẹ, thả lỏng. Đừng kéo dài thành /uː/.' },
  UW: { ipa: 'uː', example: 'food, blue', tip: 'Âm "u" DÀI, môi tròn và chu ra, kéo dài.' },
  B: { ipa: 'b', example: 'big, job', tip: 'Mím hai môi rồi bật ra, có rung dây thanh. Ở cuối từ vẫn phải bật nhẹ (job), đừng nuốt.' },
  CH: { ipa: 'tʃ', example: 'church, watch', tip: 'Đầu lưỡi chạm lợi trên, môi hơi chu ra, bật hơi mạnh "ch". Khác "ch" tiếng Việt (mềm hơn).' },
  D: { ipa: 'd', example: 'dog, good', tip: 'Đầu lưỡi chạm lợi trên (sau răng trên), bật ra có rung. Âm cuối /d/ phải nghe thấy (good, played).' },
  DH: { ipa: 'ð', example: 'this, mother', tip: 'Đặt đầu lưỡi giữa hai hàm răng, thổi hơi kèm rung dây thanh. KHÔNG đọc thành "d" hay "z".' },
  F: { ipa: 'f', example: 'fish, laugh', tip: 'Răng trên chạm nhẹ môi dưới, thổi hơi (không rung). Âm cuối /f/ phải rõ.' },
  G: { ipa: 'g', example: 'go, bag', tip: 'Cuống lưỡi chạm vòm mềm rồi bật ra, có rung. Âm cuối /g/ cần bật nhẹ.' },
  HH: { ipa: 'h', example: 'hat, behind', tip: 'Chỉ là luồng hơi thở ra nhẹ, giống "h" tiếng Việt.' },
  JH: { ipa: 'dʒ', example: 'job, bridge', tip: 'Giống /tʃ/ nhưng có rung dây thanh, môi chu ra: "dj". Không đọc thành "gi" hay "d".' },
  K: { ipa: 'k', example: 'cat, book', tip: 'Cuống lưỡi chạm vòm mềm, bật hơi mạnh. Ở cuối từ phải bật nhẹ, đừng nuốt (book, like).' },
  L: { ipa: 'l', example: 'light, feel', tip: 'Đầu lưỡi chạm lợi trên. Ở cuối từ (feel, school) giữ lưỡi chạm lợi, đừng bỏ hoặc đọc thành "u/n".' },
  M: { ipa: 'm', example: 'man, time', tip: 'Mím môi, hơi đi qua mũi.' },
  N: { ipa: 'n', example: 'no, sun', tip: 'Đầu lưỡi chạm lợi trên, hơi qua mũi. Phân biệt với /l/ và /ŋ/.' },
  NG: { ipa: 'ŋ', example: 'sing, thinking', tip: 'Cuống lưỡi chạm vòm mềm, hơi qua mũi, giống "ng" tiếng Việt. Không thêm "g" hay đổi thành /n/.' },
  P: { ipa: 'p', example: 'pen, stop', tip: 'Mím môi rồi bật hơi mạnh (đặt tay trước miệng thấy hơi). Âm cuối /p/ cần bật nhẹ.' },
  R: { ipa: 'r', example: 'red, very', tip: 'Cong đầu lưỡi về sau, KHÔNG chạm vòm miệng, môi hơi tròn. Không rung lưỡi như "r" tiếng Việt, không đọc thành "z".' },
  S: { ipa: 's', example: 'see, bus', tip: 'Đầu lưỡi gần lợi trên, thổi hơi qua khe hẹp tạo tiếng xì. Âm /s/ cuối từ (books, likes) rất quan trọng!' },
  SH: { ipa: 'ʃ', example: 'she, wash', tip: 'Môi chu tròn ra trước, lưỡi lùi sau hơn /s/, thổi hơi "sh". Phân biệt she ≠ see.' },
  T: { ipa: 't', example: 'ten, cat', tip: 'Đầu lưỡi chạm lợi trên, bật hơi mạnh (khác "t" tiếng Việt). Âm cuối /t/ phải có, dù nhẹ.' },
  TH: { ipa: 'θ', example: 'think, month', tip: 'Đặt đầu lưỡi giữa hai hàm răng, thổi hơi KHÔNG rung. Không đọc thành "th" Việt, "t" hay "s".' },
  V: { ipa: 'v', example: 'very, love', tip: 'Răng trên chạm môi dưới, thổi hơi CÓ rung. Không đọc thành /w/ hay /b/. Âm cuối /v/ (love) phải rõ.' },
  W: { ipa: 'w', example: 'we, away', tip: 'Chu tròn môi như "u" rồi mở nhanh ra nguyên âm sau: "qu/oa".' },
  Y: { ipa: 'j', example: 'yes, you', tip: 'Như "d" miền Nam/"i" lướt: lưỡi nâng gần vòm cứng rồi lướt sang nguyên âm.' },
  Z: { ipa: 'z', example: 'zoo, dogs', tip: 'Như /s/ nhưng có rung dây thanh (sờ cổ thấy rung). Âm /z/ cuối (dogs, is) đừng bỏ.' },
  ZH: { ipa: 'ʒ', example: 'measure, vision', tip: 'Như /ʃ/ nhưng có rung dây thanh, môi chu ra.' },
}

export function phonemeInfo(arpa: string): PhonemeInfo | undefined {
  return PHONEMES[arpa]
}
