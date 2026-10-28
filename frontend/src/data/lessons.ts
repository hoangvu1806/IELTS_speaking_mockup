export interface Lesson {
  id: string
  title: string
  focus: string
  desc: string
  items: string[]
}

export const LESSONS: Lesson[] = [
  {
    id: 'th',
    title: 'Âm /θ/ và /ð/',
    focus: 'θ ð',
    desc: 'Lỗi số 1 của người Việt: đọc "think" thành "tink" / "sink".',
    items: [
      'think', 'three', 'thank', 'mouth', 'month', 'this', 'that', 'mother', 'weather', 'breathe',
      'I think that is the truth.',
      'Thank you for the three things.',
      'My mother and father live together.',
      'They thought about it for a month.',
    ],
  },
  {
    id: 'final',
    title: 'Âm cuối',
    focus: 't d k s z',
    desc: 'Người Việt hay nuốt âm cuối. Giám khảo IELTS rất chú ý điểm này.',
    items: [
      'cat', 'bag', 'book', 'world', 'friend', 'asked', 'helped', 'played', 'lives', 'months',
      'She likes black coffee.',
      'I watched a good movie last night.',
      'He works hard and plays football.',
      'The kids asked their friends for help.',
    ],
  },
  {
    id: 'ship-sheep',
    title: '/iː/ và /ɪ/',
    focus: 'iː ɪ',
    desc: 'Nguyên âm dài và ngắn: sheep ≠ ship, leave ≠ live.',
    items: [
      'sheep', 'ship', 'leave', 'live', 'seat', 'sit', 'feel', 'fill', 'peach', 'pitch',
      'Please sit in this seat.',
      'I feel the need to leave.',
      'We will eat a little meat.',
    ],
  },
  {
    id: 'ae-e',
    title: '/æ/ và /e/',
    focus: 'æ e',
    desc: 'bad ≠ bed, man ≠ men. Mở miệng rộng hơn cho /æ/.',
    items: [
      'bad', 'bed', 'man', 'men', 'sad', 'said', 'cat', 'pet', 'apple', 'happen',
      'The man had a bad accident.',
      'That black cat sat on my bed.',
    ],
  },
  {
    id: 's-sh',
    title: '/s/ và /ʃ/',
    focus: 's ʃ',
    desc: 'see ≠ she, sip ≠ ship. Chu môi cho /ʃ/.',
    items: [
      'see', 'she', 'sip', 'ship', 'sort', 'short', 'sure', 'nation', 'special', 'washing',
      'She sells sea shells on the seashore.',
      'I am sure she should show us.',
    ],
  },
  {
    id: 'v-w',
    title: '/v/, /w/ và /f/',
    focus: 'v w f',
    desc: 'very ≠ wery. Răng trên chạm môi dưới cho /v/.',
    items: [
      'very', 'wine', 'vine', 'west', 'vest', 'love', 'five', 'leaf', 'leave', 'view',
      'We have a very good view.',
      'I love visiting villages in the west.',
    ],
  },
  {
    id: 'l-n-r',
    title: '/l/, /n/ và /r/',
    focus: 'l n r',
    desc: 'light ≠ night, rice ≠ lice. /r/ không rung lưỡi.',
    items: [
      'light', 'night', 'rice', 'lice', 'red', 'led', 'right', 'school', 'feel', 'world',
      'Read the rules really carefully.',
      'Learning English is not really difficult.',
    ],
  },
  {
    id: 'clusters',
    title: 'Cụm phụ âm',
    focus: 'str spr kst',
    desc: 'Không chèn nguyên âm vào giữa: "street" chứ không phải "sơ-trít".',
    items: [
      'street', 'spring', 'strong', 'splash', 'texts', 'sixth', 'clothes', 'crisps', 'twelfth', 'students',
      'Strong students study every day.',
      'The streets are crowded in spring.',
    ],
  },
  {
    id: 'ch-j',
    title: '/tʃ/, /dʒ/ và /ʒ/',
    focus: 'tʃ dʒ ʒ',
    desc: 'church, judge, measure.',
    items: [
      'church', 'chicken', 'judge', 'job', 'large', 'bridge', 'measure', 'usually', 'television', 'teacher',
      'The teacher changed the subject.',
      'I usually watch television in the evening.',
    ],
  },
  {
    id: 'ielts1',
    title: 'IELTS Part 1',
    focus: 'Câu trả lời mẫu',
    desc: 'Các câu trả lời mẫu thường gặp trong IELTS Speaking Part 1.',
    items: [
      'I live in a big city in the north of Vietnam.',
      'I am currently studying information technology at university.',
      'In my free time, I usually read books or listen to music.',
      'I think the weather in my hometown is quite pleasant.',
      'To be honest, I prefer staying at home to going out.',
      'I enjoy cooking traditional dishes with my family.',
    ],
  },
  {
    id: 'ielts2',
    title: 'IELTS Part 2 & 3',
    focus: 'Câu dài, ý phức',
    desc: 'Luyện câu dài với nhiều âm khó, giữ nhịp tự nhiên.',
    items: [
      'I would like to talk about a memorable trip that I took with my friends last summer.',
      'What impressed me the most was the breathtaking scenery along the coast.',
      'Technology has completely changed the way people communicate with each other.',
      'In my opinion, the government should invest more in public transport.',
      'Although it was challenging, the experience taught me a lot about teamwork.',
    ],
  },
]
