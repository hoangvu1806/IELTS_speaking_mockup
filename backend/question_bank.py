"""IELTS Speaking question bank: frequently recurring Part 1 topics and Part 2 cue cards with
their linked Part 3 discussion questions. A reference set of common topics - not an official
or leaked forecast for any specific quarter."""
from __future__ import annotations

PART1: dict[str, list[str]] = {
    "Work or studies": [
        "Do you work or are you a student?", "What do you like most about your job or studies?",
        "Is there anything you find difficult about it?", "What would you like to do in the future?"],
    "Hometown": [
        "Where is your hometown?", "What do you like most about it?",
        "Has your hometown changed much in recent years?", "Would you like to live there in the future?"],
    "Home and accommodation": [
        "Do you live in a house or an apartment?", "Which room do you spend the most time in?",
        "What would you like to change about your home?", "Do you plan to live there for a long time?"],
    "Daily routine": [
        "What do you usually do in the morning?", "Are you a morning person or a night person?",
        "Has your routine changed recently?", "Which part of the day do you like best?"],
    "Music": [
        "What kind of music do you like?", "Do you listen to music while studying or working?",
        "Have you ever learned to play an instrument?", "Do you prefer live music or recorded music?"],
    "Reading": [
        "Do you like reading?", "What kind of books do you enjoy?",
        "Do you prefer paper books or e-books?", "Did you read a lot when you were a child?"],
    "Weather": [
        "What's the weather like where you live?", "What's your favourite kind of weather?",
        "Does the weather affect your mood?", "Do you check the weather forecast often?"],
    "Technology": [
        "What technology do you use every day?", "Which app do you use the most?",
        "Do you think you spend too much time on your phone?", "Is there any technology you'd like to buy?"],
    "Food": [
        "What's your favourite food?", "Do you like cooking?",
        "Do you prefer eating at home or eating out?", "Has your diet changed since you were a child?"],
    "Friends": [
        "Do you have many close friends?", "How often do you meet your friends?",
        "What do you usually do together?", "Is it easy for you to make new friends?"],
    "Shopping": [
        "Do you enjoy shopping?", "Do you prefer shopping online or in stores?",
        "What was the last thing you bought?", "Do you often buy things you don't need?"],
    "Sport and exercise": [
        "Do you do any sport or exercise?", "What sport is popular in your country?",
        "Did you play sports at school?", "Do you prefer watching or playing sports?"],
    "Travel and holidays": [
        "Do you like travelling?", "Where did you go on your last holiday?",
        "Do you prefer travelling alone or with others?", "Is there a place you'd really like to visit?"],
    "Social media": [
        "Which social media do you use?", "How much time do you spend on social media?",
        "What do you usually post?", "Do you think social media has more advantages or disadvantages?"],
    "Sleep": [
        "How many hours do you usually sleep?", "Do you ever take naps during the day?",
        "What do you do if you can't sleep?", "Do you think people sleep enough these days?"],
    "Photography": [
        "Do you like taking photos?", "What do you usually take photos of?",
        "Do you prefer taking photos with a phone or a camera?", "Do you print your photos?"],
    "Public transport": [
        "How do you usually travel around your city?", "Is public transport good where you live?",
        "Do you prefer buses or trains?", "How could public transport be improved?"],
    "Learning languages": [
        "How long have you been learning English?", "What's the most difficult part of learning English?",
        "Would you like to learn another language?", "How do you practise speaking?"],
}

# (id, title, prompts, closing, part3 questions)
PART2: list[dict] = [
    {"id": "person-inspire", "topic": "Describe a person who has inspired you",
     "points": ["who this person is", "how you know them", "what they have done"], "closing": "and explain why they inspired you.",
     "part3": ["What qualities make someone a good role model?", "Do young people today have different role models from in the past?",
               "Can celebrities have a negative influence on young people?", "Should parents be the most important role models for children?"]},
    {"id": "journey", "topic": "Describe a memorable journey you have taken",
     "points": ["where you went", "who you went with", "what happened during the journey"], "closing": "and explain why it was memorable.",
     "part3": ["Why do people enjoy travelling?", "How has tourism changed in your country?",
               "What are the negative effects of tourism on local communities?", "Will people travel more or less in the future?"]},
    {"id": "skill", "topic": "Describe a skill you learned that you are proud of",
     "points": ["what the skill is", "when and how you learned it", "how difficult it was"], "closing": "and explain why you are proud of it.",
     "part3": ["What skills are most important for young people today?", "Is it better to learn skills at school or by yourself?",
               "Do older people find it harder to learn new skills?", "How will technology change the skills people need?"]},
    {"id": "book", "topic": "Describe a book you read that you found useful",
     "points": ["what the book was", "when you read it", "what it was about"], "closing": "and explain why you found it useful.",
     "part3": ["Do people read less than they used to?", "What are the benefits of reading for children?",
               "Will e-books replace printed books?", "Should the government support public libraries?"]},
    {"id": "helped", "topic": "Describe a time when you helped someone",
     "points": ["who you helped", "what the situation was", "how you helped them"], "closing": "and explain how you felt about it.",
     "part3": ["Why do some people like helping others?", "Are people less helpful in big cities?",
               "Should schools teach children to volunteer?", "Who should take care of elderly people: families or the government?"]},
    {"id": "place-visit", "topic": "Describe a place you would like to visit in the future",
     "points": ["where it is", "how you know about it", "what you would do there"], "closing": "and explain why you would like to visit it.",
     "part3": ["What makes a place attractive to tourists?", "Is it better to travel independently or on a package tour?",
               "How can governments protect famous tourist sites?", "Do you think virtual tourism could replace real travel?"]},
    {"id": "technology", "topic": "Describe a piece of technology you find useful",
     "points": ["what it is", "when you started using it", "how often you use it"], "closing": "and explain why you find it useful.",
     "part3": ["How has technology changed the way people communicate?", "Are people too dependent on technology?",
               "Should children have smartphones?", "What jobs might disappear because of technology?"]},
    {"id": "decision", "topic": "Describe an important decision you made",
     "points": ["what the decision was", "when you made it", "how you made it"], "closing": "and explain why it was important.",
     "part3": ["What important decisions do young people have to make?", "Should parents make decisions for their children?",
               "Do people make better decisions alone or in groups?", "Why do some people find it hard to make decisions?"]},
    {"id": "festival", "topic": "Describe a festival or celebration you enjoyed",
     "points": ["what it was", "where and when it took place", "what people did"], "closing": "and explain why you enjoyed it.",
     "part3": ["Why are traditional festivals important?", "Are festivals becoming too commercial?",
               "How have celebrations changed compared with the past?", "Should children learn about festivals from other cultures?"]},
    {"id": "teacher", "topic": "Describe a teacher who has influenced you",
     "points": ["who the teacher was", "what subject they taught", "what they were like"], "closing": "and explain how they influenced you.",
     "part3": ["What makes a good teacher?", "Will online learning replace teachers?",
               "Should teachers be paid more?", "Is it better to learn in small or large classes?"]},
    {"id": "city", "topic": "Describe a city you have visited that you liked",
     "points": ["which city it was", "when you went there", "what you did there"], "closing": "and explain why you liked it.",
     "part3": ["What are the advantages of living in a big city?", "Why do many young people move to cities?",
               "How can cities reduce traffic and pollution?", "Will cities be better or worse places to live in the future?"]},
    {"id": "environment", "topic": "Describe an environmental problem in your area",
     "points": ["what the problem is", "what causes it", "how it affects people"], "closing": "and explain what could be done about it.",
     "part3": ["Who is more responsible for protecting the environment: individuals or governments?",
               "Why don't more people recycle?", "Should polluting companies pay higher taxes?", "Are young people more environmentally aware than older people?"]},
    {"id": "app", "topic": "Describe a website or app you use often",
     "points": ["what it is", "how you found it", "what you use it for"], "closing": "and explain why you use it so often.",
     "part3": ["Why are some apps so popular?", "Is it safe to share personal information online?",
               "Should there be age limits for using social media?", "How has the internet changed shopping?"]},
    {"id": "goal", "topic": "Describe a goal you hope to achieve",
     "points": ["what the goal is", "when you set it", "what you are doing to achieve it"], "closing": "and explain why this goal is important to you.",
     "part3": ["Is it important to set goals in life?", "Do young people today have realistic goals?",
               "What stops people from achieving their goals?", "Is success mainly about hard work or luck?"]},
    {"id": "dish", "topic": "Describe a traditional dish from your country",
     "points": ["what the dish is", "how it is made", "when people eat it"], "closing": "and explain why it is popular.",
     "part3": ["How have eating habits changed in your country?", "Is fast food a threat to traditional food?",
               "Should schools teach children how to cook?", "Why do people like trying food from other countries?"]},
    {"id": "new-thing", "topic": "Describe a time when you tried something new",
     "points": ["what you tried", "when and where it was", "why you decided to try it"], "closing": "and explain how you felt about the experience.",
     "part3": ["Why are some people afraid of trying new things?", "Is it good for children to try many different activities?",
               "Do people become less adventurous as they get older?", "How can companies encourage employees to be creative?"]},
    {"id": "conversation", "topic": "Describe an interesting conversation you had",
     "points": ["who you talked to", "what you talked about", "where it happened"], "closing": "and explain why it was interesting.",
     "part3": ["Do people talk to each other less because of technology?", "What makes someone a good listener?",
               "Is it easier to talk to strangers or to friends?", "Should communication skills be taught at school?"]},
    {"id": "small-business", "topic": "Describe a successful small business you know",
     "points": ["what the business is", "how you know about it", "what it sells or offers"], "closing": "and explain why you think it is successful.",
     "part3": ["What are the benefits of small local businesses?", "Why do many young people want to start their own business?",
               "Can small shops compete with online giants?", "What qualities does a successful businessperson need?"]},
]


def part2(card_id: str | None) -> dict | None:
    return next((c for c in PART2 if c["id"] == card_id), None)


def summary() -> dict:
    return {"part1": [{"topic": t, "questions": q} for t, q in PART1.items()],
            "part2": [{"id": c["id"], "topic": c["topic"], "points": c["points"], "closing": c["closing"], "part3": c["part3"]}
                      for c in PART2]}
