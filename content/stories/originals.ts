import type { StoryNode, StorySource } from '../../src/lib/stories/types';
// Original editorial content. Numbers are local node addresses, not UI logic.
const choices = (...items: [string, number, boolean?][]) =>
  items.map(([text, next, correct], i) => ({
    id: String.fromCharCode(97 + i),
    text,
    next: 'n' + next,
    ...(correct === undefined ? {} : { correct }),
  }));
function scene(
  speaker: string,
  text: string,
  options: [string, number, boolean?][],
  word: string,
  grammar?: string,
): StoryNode {
  const [term, translation] = word.split('|');
  return {
    speaker,
    text,
    choices: choices(...options),
    vocabulary: [{ word: term, translation }],
    ...(grammar ? { grammar } : {}),
  };
}
function task(
  speaker: string,
  text: string,
  question: string,
  explanation: string,
  options: [string, number, boolean][],
  word: string,
  grammar: string = explanation,
): StoryNode {
  return {
    ...scene(speaker, text, options, word, grammar),
    question,
    explanation,
  };
}
function end(
  text: string,
  title: string,
  reward: string,
  word: string,
): StoryNode {
  return { ...scene('Narrator', text, [], word), ending: { title, reward } };
}
function story(
  meta: Omit<StorySource, 'revision' | 'published' | 'document'>,
  nodes: StoryNode[],
): StorySource {
  return {
    ...meta,
    revision: 1,
    published: true,
    document: {
      start: 'n1',
      nodes: Object.fromEntries(nodes.map((n, i) => ['n' + (i + 1), n])),
    },
  };
}
export const stories: StorySource[] = [
  story(
    {
      slug: 'first-school-day',
      title: 'Первый день в школе',
      subtitle: 'A Place at the Table',
      level: 'A1',
      minutes: 10,
      free_preview: true,
      description:
        'Новая школа, потерянная карточка и свободное место за столом. Познакомься с одноклассниками, попроси помощь и выбери, как закончится твой первый день.',
    },
    [
      scene(
        'Narrator',
        'It is your first day at a new school. Your bag is blue. Your classroom is Room 12. At the door, a boy has a big box. A girl has a school map. The bell rings. You have two minutes.',
        [
          ['Hello! Can I help with the box?', 2],
          ['Excuse me. Where is Room 12?', 3],
        ],
        'bell|школьный звонок',
        'Can I help? — вежливое предложение помощи. Excuse me — способ привлечь внимание незнакомого человека.',
      ),
      scene(
        'Ben',
        'Thank you! My name is Ben. These are our class books. The box is heavy. We take it to Room 12 together. A small yellow card falls from a book. There is no name on it.',
        [['Let us take the card to class.', 4]],
        'heavy|тяжёлый',
      ),
      scene(
        'Mia',
        'I am Mia. Room 12 is next to the library. Come with me. There is a yellow card on the floor near the library door. It has a picture of a tree. Is it a library card?',
        [['Let us ask our teacher.', 4]],
        'next to|рядом с',
      ),
      scene(
        'Ms Green',
        'Welcome! I am Ms Green. This is our class. The yellow card is for our lunch game. One student needs it. Please sit down first. There is a chair by the window and a chair near the door.',
        [['Introduce yourself to the class.', 5]],
        'chair|стул',
        'I am / You are / This is — формы глагола be в настоящем времени. I am new здесь значит «Я новенький / новенькая».',
      ),
      task(
        'Ms Green',
        'Please tell us your name. Then say that this is your first day. Ben smiles. Mia gives you a pencil. You want to speak to the whole class. Choose the sentence for your introduction.',
        'Как правильно представиться?',
        'Правильно: I am new here. С I используется am. Is относится к he, she, it.',
        [
          ['Hello! I am new here.', 6, true],
          ['Hello! I is new here.', 7, false],
        ],
        'new|новый; новенький',
        'Глагол be: I am, he/she/it is, you/we/they are.',
      ),
      scene(
        'Ben',
        'Welcome! Your English is clear. You sit by the window. Ben shows you the class timetable. Lunch is at twelve. There is a small tree in the picture on the lunch menu. It is the same tree as on your card.',
        [['Ask about the yellow card.', 8]],
        'timetable|расписание',
      ),
      scene(
        'Mia',
        'You say, "I is new here." Mia speaks quietly: "I am new here." You try again. Ms Green smiles. A mistake is OK. Mia shows you the lunch menu. There is a small tree on it, like the tree on your card.',
        [['Try again, then ask about the card.', 8]],
        'quietly|тихо',
      ),
      scene(
        'Narrator',
        'At break, Ben and Mia look at the card. Ben wants to ask the lunch cook. Mia wants to look at the school garden. The card has a tree, but it also has a small cup. Where do you go?',
        [
          ['Let us ask the cook.', 9],
          ['Let us look in the garden.', 10],
        ],
        'break|перемена',
      ),
      scene(
        'Cook',
        'The cook is busy, but she looks at the card. "This is a table card," she says. "The tree table is for new students and their friends. But the card needs one more thing. Ask your teacher about the cup."',
        [['Thank the cook and go back.', 11]],
        'cook|повар',
      ),
      scene(
        'Mia',
        'The garden is small and green. There is a tree, a bench and a red cup. A sign says: "Please bring your own cup to lunch." Mia laughs. "Our tree is outside, but the card is for a table inside!"',
        [['Take your own cup from your bag.', 11]],
        'bring|приносить',
      ),
      scene(
        'Ms Green',
        'Yes, the tree table is for new students. Please bring your own cup. There are three places at the table. You have the card. Ben and Mia are waiting near the lunch room. You want them to sit with you.',
        [['Invite your new friends.', 12]],
        'place|место',
      ),
      task(
        'Narrator',
        'You see Ben and Mia at the door. You want to sit together at the tree table. You have three places, so both friends can come. Choose a question to invite them.',
        'Как пригласить друзей сесть вместе?',
        'Can you sit with me? — вопрос-приглашение. После can идёт начальная форма sit, без to.',
        [
          ['Can you sit with me?', 13, true],
          ['Can you to sit with me?', 14, false],
        ],
        'together|вместе',
        'Can + подлежащее + глагол: Can you sit? Не добавляем to после can.',
      ),
      scene(
        'Ben',
        'Yes, thank you! We can sit with you. Ben carries the water. Mia carries three plates. You put the yellow card on the table. Now another new student is standing at the door with a lunch bag.',
        [['Look at the new student.', 15]],
        'plate|тарелка',
      ),
      scene(
        'Mia',
        'Mia understands you, but she helps: "Can you sit with me? No to." You say it again. Ben and Mia sit down. You see another new student at the door. The tree table has three places, and all three are full.',
        [['Think about another place.', 16]],
        'full|полный; занятый',
      ),
      scene(
        'Narrator',
        'The new student looks at your yellow card. "I am new, too," he says. His name is Leo. Your table is full, but the next table has a free chair. Ms Green is near the door. You can ask for help.',
        [
          ['Ms Green, can we have one more chair?', 17],
          ['Let us take our lunch to the next table.', 18],
        ],
        'one more|ещё один',
      ),
      scene(
        'Leo',
        'I am Leo. Is this the new students table? You show him the yellow card. You can ask Ms Green to move a chair. Or you can show Leo the next table and meet him after lunch.',
        [
          ['Let us ask the teacher for a chair.', 18],
          ['You can sit there. See you after lunch!', 19],
        ],
        'after|после',
      ),
      end(
        'Ms Green brings a chair. Now four friends sit at the tree table. You give Leo a cup. He smiles. The card is small, but your table is big enough. At home, you say, "My new school is a good place."',
        'Стол для всех',
        'Значок «Первое приглашение»',
        'enough|достаточно',
      ),
      end(
        'You and your friends make a new place for Leo. Lunch is a little late, but nobody eats alone. Ben writes four names on the back of the card. Tomorrow you can meet at the same door and go to class together.',
        'Четыре новых имени',
        'Значок «Новая компания»',
        'alone|в одиночестве',
      ),
      end(
        'Leo sits at the next table. After lunch, you meet him at the door. "Hello, I am new here, too," you say. He has a red bag. You walk to Room 12 together. There is time for a new friend after lunch.',
        'Дружба после обеда',
        'Значок «Второй шанс»',
        'walk|идти пешком',
      ),
    ],
  ),
  story(
    {
      slug: 'online-friend',
      title: 'Новый друг в интернете',
      subtitle: 'The Pixel Garden',
      level: 'A2',
      minutes: 12,
      free_preview: false,
      description:
        'Совместный пиксельный сад почти готов, но незнакомый участник просит личный контакт. Реши, кому доверять, как проверить участника и кому достанется авторство.',
    },
    [
      scene(
        'Narrator',
        'You are building a pixel garden in an online art club. Everyone uses a nickname. A new member, CloudFox, sends a picture of a blue flower. "Can I help with your garden?" they ask. The club exhibition opens tomorrow.',
        [
          ['Ask CloudFox about the flower.', 2],
          ['Read CloudFox’s public club profile.', 3],
        ],
        'nickname|псевдоним',
      ),
      scene(
        'CloudFox',
        'I drew this flower yesterday. It looks like a little umbrella. I can make more colours if you like. You ask where it should go. CloudFox suggests the empty corner near your pond. They do not ask to change the whole garden.',
        [['Suggest working in the club room.', 4]],
        'pond|пруд',
      ),
      scene(
        'Narrator',
        'The profile is new, but it includes two public drawings. One is a blue flower. There is no real name or address. The club rules say new artists can join shared projects in the public work room. A new profile is not proof of a bad person.',
        [['Invite CloudFox to the public work room.', 4]],
        'shared|совместный',
      ),
      scene(
        'CloudFox',
        'Let us add the flowers tonight. Can you give me your phone number? It is easier to send files that way. You like the drawing, but the club already has a safe file area. You can be friendly and keep personal information private.',
        [['Choose your reply.', 5]],
        'private|личный; закрытый',
        'Can we…? — мягкое предложение совместного действия: Can we use the club room?',
      ),
      task(
        'Narrator',
        'You want to continue the project without giving your phone number. The club room lets members send drawings. Choose the reply that keeps a clear boundary and offers another way to work together.',
        'Which reply keeps your information private?',
        'Можно отказаться от личного контакта и предложить площадку клуба. Вежливость не обязывает делиться номером.',
        [
          ['Can we use the club file area instead?', 6, true],
          ['Here is my number. Please keep it secret.', 7, false],
        ],
        'instead|вместо этого',
        'Can we use… instead? — вежливое предложение альтернативы, без передачи личных данных.',
      ),
      scene(
        'CloudFox',
        'Of course. I did not know about that area. Thanks for showing me. CloudFox uploads the flower picture there. You download the image through the club tools. It is only a picture, and you can see it before adding it to the project.',
        [['Plan the garden together.', 8]],
        'upload|загрузить на сервер',
      ),
      scene(
        'Narrator',
        'Before you send anything, the club reminds you not to post phone numbers. You remove the unsent message. "Let us use the file area," you write instead. CloudFox agrees. You can change your mind about sharing personal information.',
        [['Continue in the club room.', 8]],
        'unsent|неотправленный',
      ),
      scene(
        'CloudFox',
        'The garden needs a path and a sign. CloudFox can draw one of them. You have time to make the other. A member called Reed leaves a comment: "That flower looks familiar." There is no explanation yet.',
        [
          ['Ask Reed for the public source.', 9],
          ['Ask CloudFox how they made the flower.', 10],
        ],
        'source|источник',
      ),
      scene(
        'Reed',
        'I saw a similar flower in last month’s public challenge. Here is its title in the club archive. You find a red flower by an artist called Kite. The shape is similar, but the colours and leaves are different. It is worth asking before making an accusation.',
        [['Compare the two public drawings.', 11]],
        'similar|похожий',
      ),
      scene(
        'CloudFox',
        'I used the club’s umbrella-flower challenge sheet. It says everyone can draw the same basic shape. I changed the leaves. CloudFox shows you the challenge title in the public archive. You can check the instructions yourself rather than just accept the claim.',
        [['Read the challenge instructions.', 11]],
        'instructions|инструкции',
      ),
      scene(
        'Narrator',
        'The challenge allows artists to use the basic shape if they credit the club template. CloudFox forgot the credit line. The garden can still enter the exhibition if you add it before midnight. You need to tell the moderator what you have checked.',
        [['Write a short update.', 12]],
        'credit|указание авторства или источника',
        'Present perfect связывает сделанное с результатом сейчас: We have checked the instructions — проверили, и теперь знаем условия.',
      ),
      task(
        'Moderator',
        'Have you checked the template instructions? You checked them together a moment ago. The result matters now: you can add the correct credit line. Choose the sentence that fits the moderator’s question.',
        'Choose the correct update.',
        'We have checked the instructions. После have нужна третья форма: checked. Check без окончания здесь не подходит.',
        [
          ['We have checked the instructions.', 13, true],
          ['We have check the instructions.', 14, false],
        ],
        'checked|проверили',
        'Present perfect: have/has + past participle. Для правильного check третья форма — checked.',
      ),
      scene(
        'Moderator',
        'Thanks for the clear update. The template can be used with a credit line. Please add the line and list both artists. CloudFox writes: "I was worried you would stop talking to me." You reply that checking a source helps everyone.',
        [['Choose how to finish the project.', 15]],
        'both|оба',
      ),
      scene(
        'Moderator',
        'I understand. Write "We have checked" when the check is complete. The credit information is useful, but I still need your corrected project note. You have time to fix the English and add the source before midnight.',
        [['Decide what to submit.', 16]],
        'complete|завершённый',
      ),
      scene(
        'CloudFox',
        'The sign is ready: "A small garden by two artists, using the club flower template." There is space for a short note. You can submit together now or ask to present the work in tomorrow’s public club session.',
        [
          ['Submit the garden with shared credit.', 17],
          ['Ask for a public presentation together.', 18],
        ],
        'submit|отправить на рассмотрение',
      ),
      scene(
        'Narrator',
        'You correct the note and add the template credit. There are only ten minutes left. CloudFox asks if you can still finish together. You can ask the moderator to check the note now or save the garden for the next exhibition.',
        [
          ['Ask the moderator to check the final note.', 18],
          ['Save it for the next exhibition.', 19],
        ],
        'final|окончательный',
      ),
      end(
        'The garden appears in the exhibition with both nicknames and the template credit. CloudFox adds a tiny umbrella beside the pond. You have a new art partner, not a stranger with your personal details. Tomorrow’s plan is already in the public club room.',
        'Сад с двумя подписями',
        'Значок «Надёжный соавтор»',
        'details|сведения',
      ),
      end(
        'In the public session, you explain how the garden was made. The moderator checks the note before showing it. CloudFox describes the blue flower. Reed thanks you for checking the source calmly. Your first shared project becomes a useful example for the whole club.',
        'Открытая мастерская',
        'Значок «Спокойный диалог»',
        'calmly|спокойно',
      ),
      end(
        'You save a draft with the correct source and both nicknames. There is no exhibition badge today, but you have not lost the garden. CloudFox agrees to add a night sky next week. A good online friendship can grow slowly, in a shared space with clear rules.',
        'Сад на следующую неделю',
        'Значок «Свои границы»',
        'draft|черновик',
      ),
    ],
  ),
  story(
    {
      slug: 'server-mystery',
      title: 'Тайна игрового сервера',
      subtitle: 'The Clock Beneath Spawn',
      level: 'B1',
      minutes: 15,
      free_preview: false,
      description:
        'На игровом сервере каждую ночь исчезает мост. Изучи журнал событий, поговори с командой и найди объяснение, прежде чем город лишится главной переправы.',
    },
    [
      scene(
        'Narrator',
        'Every morning, the bridge beside the spawn point is missing. By lunchtime it returns. Nobody has lost an item, but players are blaming each other. You help run the community noticeboard. Tonight you receive a message: "Watch the clock beneath spawn."',
        [
          ['Inspect the public event log.', 2],
          ['Ask the night-shift builder what happened.', 3],
        ],
        'spawn point|точка появления игрока',
      ),
      scene(
        'Narrator',
        'The event log shows a scheduled world-copy job at 02:00. A bridge update appears at 02:01, but its author is a maintenance account. The same sequence happened three nights in a row. The clock message may refer to a schedule rather than a hidden object.',
        [['Share the timestamps with the team.', 4]],
        'scheduled|запланированный',
      ),
      scene(
        'Nora',
        'I finished the bridge at one in the morning. When I returned after two, it had gone. I took a screenshot because I thought I had saved it incorrectly. Nora’s screenshot shows the old wooden bridge, not the new stone one described on the noticeboard.',
        [['Compare her screenshot with the log.', 4]],
        'screenshot|снимок экрана',
      ),
      scene(
        'Narrator',
        'You now have a log and a screenshot. A public sign names the stone bridge as the latest version. The log says the night copy loads a map made before that version existed. You need to describe the order of events without accusing a player.',
        [['Explain the timeline to Nora.', 5]],
        'timeline|последовательность событий',
        'Past perfect обозначает действие раньше другого момента в прошлом: The copy had started before the bridge disappeared.',
      ),
      task(
        'Nora',
        'Did the map copy start before the bridge disappeared? The copy started at 02:00; the bridge disappeared at 02:01. Choose the sentence that makes this order clear.',
        'Which sentence describes the earlier action?',
        'The copy had started before the bridge disappeared. Had started показывает действие, которое произошло раньше другого прошедшего события.',
        [
          ['The copy had started before the bridge disappeared.', 6, true],
          [
            'The copy starts tomorrow, so it caused yesterday’s loss.',
            7,
            false,
          ],
        ],
        'before|до того как',
      ),
      scene(
        'Nora',
        'That makes sense. The missing bridge may be an old map returning, not someone removing blocks. Nora gives you access to a read-only test world. Its clock is set to two in the morning, so you can observe the copy without touching the main server.',
        [['Choose a safe investigation.', 8]],
        'read-only|только для чтения',
      ),
      scene(
        'Narrator',
        'Nora points to the times again. Tomorrow cannot explain yesterday’s event. You rewrite the note with "had started" and keep both pieces of evidence. The error in your explanation has not changed the server. You can still investigate in a read-only test world.',
        [['Check the evidence safely.', 8]],
        'evidence|доказательства; фактические данные',
      ),
      scene(
        'Narrator',
        'The test world has a small clock under the spawn platform. It displays the backup version, not the time. You can compare its number with the public map archive or ask the maintenance volunteer to explain the label.',
        [
          ['Compare the archive version numbers.', 9],
          ['Ask the maintenance volunteer.', 10],
        ],
        'backup|резервная копия',
      ),
      scene(
        'Narrator',
        'The clock reads 14, while the current map is version 16. Version 14 has the wooden bridge in Nora’s screenshot. A note beside version 16 says "restore after market cleanup". Something still treats the old cleanup map as the normal night map.',
        [['Find the cleanup schedule.', 11]],
        'restore|восстановить',
      ),
      scene(
        'Ivo',
        'The clock marks our recovery map. We used version 14 during the market event. I thought I had removed its schedule. Ivo does not have permission to change the main schedule alone. He asks you to find the cleanup entry so an administrator can review it.',
        [['Look for the remaining cleanup entry.', 11]],
        'recovery|восстановление',
      ),
      scene(
        'Narrator',
        'The cleanup entry is still active. It loads version 14 at night, then version 16 at noon. A comment says "temporary". You have found a likely explanation, but changing the main schedule is an administrator’s job. Your report needs a safe recommendation.',
        [['Write a conditional recommendation.', 12]],
        'temporary|временный',
        'First conditional: If + present simple, will + начальная форма. Это вероятное последствие будущего условия.',
      ),
      task(
        'Administrator',
        'What will happen if we disable the old cleanup job? The test shows version 16 stays loaded without it. Choose a clear prediction based on that result.',
        'Choose the correct conditional sentence.',
        'If we disable the old job, the new bridge will stay. После if — present simple, в результате — will + stay.',
        [
          ['If we disable the old job, the new bridge will stay.', 13, true],
          ['If we will disable the old job, the new bridge stay.', 14, false],
        ],
        'disable|отключить',
        'В обычном first conditional не ставим will в if-части: If we disable…, … will stay.',
      ),
      scene(
        'Administrator',
        'Your recommendation is clear. I can disable the old job after a backup, or move it to the test server for one more night. Both are controlled changes. You also have enough evidence to correct the public rumour that a player destroyed the bridge.',
        [['Choose the next controlled step.', 15]],
        'rumour|слух',
      ),
      scene(
        'Administrator',
        'I understand the idea, but please correct the report before I approve a change. Write "If we disable…, the bridge will stay." A second administrator is available tomorrow. You can request a reviewed test then, or publish what is confirmed and leave the cause provisional.',
        [['Decide how to report the finding.', 16]],
        'provisional|предварительный',
      ),
      scene(
        'Nora',
        'The bridge is crowded this evening. People want an answer, but you should not promise more than the test supports. The administrator is ready with a backup. Do you recommend fixing the schedule now or watching it once more in the test world?',
        [
          ['Recommend the backed-up schedule fix.', 17],
          ['Request one more night in the test world.', 18],
        ],
        'supports|подтверждает',
      ),
      scene(
        'Narrator',
        'You correct the English and list the timestamps. Your report separates the observed map changes from the suspected schedule problem. You can ask for a reviewed test tomorrow, or post a careful notice now without claiming that the mystery is fully solved.',
        [
          ['Request tomorrow’s reviewed test.', 18],
          ['Publish only the confirmed findings.', 19],
        ],
        'suspected|предполагаемый',
      ),
      end(
        'After taking a backup, the administrator disables the obsolete job. The next morning, the stone bridge is still there. Your notice explains the schedule error and clears the accused players. Nora adds a small clock design to the bridge, this time as decoration rather than a warning.',
        'Мост остаётся',
        'Значок «Хранитель переправы»',
        'obsolete|устаревший',
      ),
      end(
        'The team watches another copy cycle in the test world. It reproduces the problem exactly. Two administrators then approve the schedule fix. The bridge returns permanently a day later. Players remember the extra wait, but they also see a clear record of how the team checked its answer.',
        'Разгадка на тестовом мире',
        'Значок «Проверка прежде решения»',
        'reproduce|воспроизвести',
      ),
      end(
        'Your notice says the bridge changes match a scheduled map copy and that nobody has evidence of deliberate damage. The main fix waits for review. The bridge may disappear once more, but the accusations stop. You leave a precise report that the next administrator can continue without guessing.',
        'Честный предварительный отчёт',
        'Значок «Точные слова»',
        'deliberate|намеренный',
      ),
    ],
  ),
  story(
    {
      slug: 'unknown-city',
      title: 'Путешествие в неизвестный город',
      subtitle: 'The City That Changed Its Signs',
      level: 'B2',
      minutes: 18,
      free_preview: false,
      description:
        'В незнакомом городе меняют названия улиц, а твой билет ведёт к закрытому причалу. Собери маршрут из разговоров, карт и объявлений и реши, ради чего менять планы.',
    },
    [
      scene(
        'Narrator',
        'Your train arrives in Bellwater on the morning of its annual river festival. You booked a workshop at North Quay, yet the station map calls it Foundry Steps. Your phone has little charge, and the visitor desk will not open for another hour. Two volunteers are folding paper signs nearby.',
        [
          ['Ask a volunteer about the two names.', 2],
          ['Compare the station map with your printed ticket.', 3],
        ],
        'quay|набережная; причал',
      ),
      scene(
        'Volunteer',
        'Foundry Steps is the old name. The festival uses it to celebrate the city’s industrial history. Unfortunately, some signs have already changed and others have not. The volunteer circles the river on your ticket and warns that the footbridge is closed for a rehearsal until eleven.',
        [['Ask for a route that avoids the bridge.', 4]],
        'rehearsal|репетиция',
      ),
      scene(
        'Narrator',
        'The ticket includes a small outline of three warehouses beside the river. The station map has the same outline at Foundry Steps. The names differ, but the buildings match. A notice under the map says the footbridge is closed until eleven for a festival rehearsal.',
        [['Look for an alternative crossing.', 4]],
        'outline|контур; очертание',
      ),
      scene(
        'Narrator',
        'A café owner offers directions while serving the morning queue. There is a tram to the south bank and a pedestrian ferry from Mill Lane. You need to confirm whether the ferry runs today, rather than assume a normal weekday timetable applies during the festival.',
        [['Ask an indirect question.', 5]],
        'pedestrian|пешеходный',
        'В косвенном вопросе после Could you tell me порядок слов прямой: whether the ferry is running, а не whether is the ferry running.',
      ),
      task(
        'Café owner',
        'I can check the festival timetable for you. What would you like to know? You want to ask politely whether the ferry is operating today.',
        'Choose the correctly ordered indirect question.',
        'Could you tell me whether the ferry is running today? Внутри косвенного вопроса подлежащее the ferry стоит перед is.',
        [
          ['Could you tell me whether the ferry is running today?', 6, true],
          ['Could you tell me whether is the ferry running today?', 7, false],
        ],
        'whether|ли; вводит косвенный вопрос',
        'Could you tell me + whether + подлежащее + сказуемое. Вложенная часть не использует вопросительную инверсию.',
      ),
      scene(
        'Café owner',
        'It is running, but only from the temporary landing behind the mill. The usual stop is fenced off. She draws a square beside the word "mill" on your ticket. The tram is simpler, although it will take twenty minutes longer. Your workshop starts in forty minutes.',
        [['Choose your route.', 8]],
        'landing|место высадки; пристань',
      ),
      scene(
        'Café owner',
        'You mean whether the ferry is running? Yes, from a temporary landing behind the mill. She repeats the question with the subject before the verb, then draws the landing on your ticket. You still have time for the ferry; the tram is slower but easier to find.',
        [['Choose with the new information.', 8]],
        'fenced off|огороженный; закрытый забором',
      ),
      scene(
        'Narrator',
        'Outside, a musician asks whether you have seen the festival rehearsal. It is beside the closed bridge, along the way to the mill. You can go directly to the temporary landing or allow five minutes to hear the music and ask the stewards about access.',
        [
          ['Head directly to the mill landing.', 9],
          ['Stop briefly at the rehearsal.', 10],
        ],
        'steward|распорядитель; сотрудник мероприятия',
      ),
      scene(
        'Narrator',
        'The temporary landing is marked by a blue board, not by the yellow ferry symbol on your old map. A passenger points out a second notice: the last return boat leaves at four. You photograph the notice and keep enough battery to show it later without searching online.',
        [['Read the workshop organiser’s notice.', 11]],
        'return boat|обратный рейс лодки',
      ),
      scene(
        'Steward',
        'The musicians are rehearsing a piece inspired by the old foundry. A steward says the workshop organiser has moved the afternoon session to the covered market because rain is expected. She directs you to the mill landing, where the organiser has posted a written update.',
        [['Go to the landing and check the update.', 11]],
        'foundry|литейный завод',
      ),
      scene(
        'Narrator',
        'The organiser’s notice confirms two locations: morning at North Quay, afternoon at the covered market. Visitors may choose either session. The morning workshop will begin outdoors despite the forecast, but the afternoon one is sheltered. You consider how the bridge closure affected your plans.',
        [['Describe an unreal alternative.', 12]],
        'sheltered|защищённый от непогоды',
        'Third conditional описывает нереальное прошлое: If + had + V3, would have + V3.',
      ),
      task(
        'Narrator',
        'The bridge was closed, so you looked for another route. Imagine the opposite situation in the past. Which sentence expresses that unreal alternative?',
        'Choose the correct third conditional.',
        'If the bridge had been open, I would have walked across it. Had been задаёт нереальное условие в прошлом, would have walked — его результат.',
        [
          [
            'If the bridge had been open, I would have walked across it.',
            13,
            true,
          ],
          [
            'If the bridge would be open yesterday, I will walk across it.',
            14,
            false,
          ],
        ],
        'across|через; на другую сторону',
        'If the bridge had been open — условие о прошлом. I would have walked — действие, которое тогда могло произойти.',
      ),
      scene(
        'Narrator',
        'You tell another visitor why you changed your route, and she understands immediately. She is heading to the afternoon session. There is no extra fee to switch, provided you show the original ticket. The ferry is boarding now; the covered market is a short walk from this bank.',
        [['Decide what matters most today.', 15]],
        'provided|при условии что',
      ),
      scene(
        'Narrator',
        'You revise your sentence: "If the bridge had been open, I would have walked across it." While you practise, a ferry volunteer checks your ticket. The morning boat is almost full. You can join the afternoon workshop or make a new plan on this side of the river.',
        [['Choose a realistic alternative.', 16]],
        'revise|исправлять; пересматривать',
      ),
      scene(
        'Ferry volunteer',
        'There is one place left. If you board now, you should reach the morning workshop on time. Alternatively, the afternoon session will give you more room to explore the market and understand the city’s changing signs. Neither choice changes the validity of your ticket.',
        [
          ['Take the ferry to the morning workshop.', 17],
          ['Switch to the sheltered afternoon session.', 18],
        ],
        'validity|действительность; срок действия',
      ),
      scene(
        'Narrator',
        'The next ferry will arrive after the morning session begins. The organiser confirms your afternoon place by checking the printed ticket. You can accept it, or skip the workshop and follow the free self-guided walk printed on the back of your festival map.',
        [
          ['Accept the afternoon workshop place.', 18],
          ['Choose the self-guided city walk.', 19],
        ],
        'self-guided|самостоятельный, без экскурсовода',
      ),
      end(
        'You reach North Quay as the instructor sets out sketchbooks. When the rain begins, the group draws the shifting reflections beneath a canopy. Your sketch includes both names for the quay. You have kept your original appointment, and the journey has given you a subject you could not have planned.',
        'Рисунок у северного причала',
        'Значок «Маршрут найден»',
        'canopy|навес',
      ),
      end(
        'At the covered market, you learn why residents still use the old street names. Your afternoon sketch layers the foundry’s outline over the modern quay. The workshop begins with your question about changing signs. By adjusting your timetable, you have turned a confusing arrival into the theme of your visit.',
        'Город с двумя именами',
        'Значок «Гибкий путешественник»',
        'layers|накладывает слоями',
      ),
      end(
        'You follow the map’s free walk past the mill, the market and a wall of historic street signs. You miss the workshop, but write a short travel note explaining each detour. At the station, you help another visitor match North Quay to Foundry Steps. The unfamiliar city is already easier to describe.',
        'Собственная карта города',
        'Значок «Исследователь переулков»',
        'detour|обходной путь',
      ),
    ],
  ),
  story(
    {
      slug: 'secret-message',
      title: 'Секретное сообщение',
      subtitle: 'The Margin Between the Lines',
      level: 'B2',
      minutes: 18,
      free_preview: false,
      description:
        'В библиотечном буклете найдено сообщение без подписи. Проверь контекст, восстанови последовательность подсказок и реши, стоит ли делать находку публичной.',
    },
    [
      scene(
        'Narrator',
        'While volunteering at a community library, you find a pencilled note inside an old exhibition booklet: "The answer is not in the headline. Read what we nearly left out." Tomorrow the library will display the booklet online. The note might be a puzzle, an editing instruction or a private message.',
        [
          ['Examine the booklet’s margins.', 2],
          ['Ask the librarian about the exhibition.', 3],
        ],
        'margin|поле страницы',
      ),
      scene(
        'Narrator',
        'Several captions have tiny numbers in their margins. The numbers are printed, whereas the note is in pencil. One caption has been crossed out on a loose proof sheet. Its subject is a volunteer-built reading room that never appeared in the final exhibition title.',
        [['Compare the proof with the published booklet.', 4]],
        'proof sheet|корректурный лист',
      ),
      scene(
        'Librarian',
        'The exhibition celebrated a famous architect, but volunteers built the reading room before he redesigned it. Some captions were shortened to fit the pages. The librarian remembers an editor who disliked the omissions. She gives you a public catalogue record, not the editor’s private contact details.',
        [['Check the catalogue against the booklet.', 4]],
        'omission|пропуск; упущение',
      ),
      scene(
        'Narrator',
        'The public record credits the volunteers, while the final booklet mentions only the architect. The note could be a reminder to restore that credit. You should distinguish a plausible explanation from an established fact before presenting the discovery to tomorrow’s visitors.',
        [['Summarise what the note might mean.', 5]],
        'plausible|правдоподобный',
        'Модальные глаголы о прошлом: might have been — возможно, было; must have been — уверенный вывод по веским основаниям.',
      ),
      task(
        'Librarian',
        'Do we know who wrote the pencilled note? You have no handwriting sample and no signed record. Which statement reflects the uncertainty rather than inventing certainty?',
        'Choose a cautious conclusion.',
        'It might have been written by an editor. Might have been передаёт возможное объяснение. Must have been by the architect утверждает уверенность, для которой нет оснований.',
        [
          ['It might have been written by an editor.', 6, true],
          ['It must have been written by the architect himself.', 7, false],
        ],
        'uncertainty|неопределённость',
        'Might + have + been + V3: предположение о том, кем действие было совершено в прошлом.',
      ),
      scene(
        'Librarian',
        'Exactly. We can investigate the message without claiming to know its author. She suggests treating the numbered captions as a possible reading order. You copy the public text, keeping the pencilled original in its protective sleeve so it will not be damaged.',
        [['Choose how to test the reading order.', 8]],
        'sleeve|защитный конверт; чехол',
      ),
      scene(
        'Narrator',
        'The librarian asks what evidence connects the architect to the handwriting. You have none. You replace "must" with "might" in your draft. The correction matters: a confident guess could become a false attribution once the booklet is published online.',
        [['Continue with the numbered captions.', 8]],
        'attribution|указание авторства',
      ),
      scene(
        'Narrator',
        'The numbers could indicate page order or caption order. You can sort the first words of the captions by their small printed numbers, or compare those numbers with the original layout plan. Both methods use public documents already approved for the exhibition.',
        [
          ['Read the first words in number order.', 9],
          ['Compare the original layout plan.', 10],
        ],
        'layout|макет; расположение элементов',
      ),
      scene(
        'Narrator',
        'The first words form a phrase: "Remember those who made room." It is meaningful, but not proof of a deliberate code. The omitted caption begins with "Together". You mark the phrase as a possible pattern and look for a document that explains the numbers.',
        [['Search the public editing notes.', 11]],
        'deliberate|намеренный',
      ),
      scene(
        'Narrator',
        'The layout plan numbers captions to guide the printer. However, an attached public editing note asks that their opening words remain unchanged. That unusual request makes the first words worth reading in order. The omitted caption begins with "Together" and completes the phrase.',
        [['Find the full editing note.', 11]],
        'attached|приложенный',
      ),
      scene(
        'Narrator',
        'The editing note says: "Please retain the opening words; together they acknowledge the reading-room volunteers." It establishes the editor’s intention for the printed pattern, though not the identity of the pencilled-note writer. You need to report the instruction accurately without changing its meaning.',
        [['Turn the instruction into reported speech.', 12]],
        'retain|сохранять',
        'Reported instructions: asked + дополнение + to + глагол. Например: The editor asked us to retain the opening words.',
      ),
      task(
        'Librarian',
        'What did the editor ask the printer to do? The written instruction was "Please retain the opening words." Choose an accurate report of that request.',
        'Choose the correct reported instruction.',
        'The editor asked the printer to retain the opening words. Asked + someone + to do передаёт просьбу. Вариант asked… retaining здесь неверен.',
        [
          [
            'The editor asked the printer to retain the opening words.',
            13,
            true,
          ],
          [
            'The editor asked the printer retaining the opening words.',
            14,
            false,
          ],
        ],
        'opening words|первые слова',
        'Ask someone to do something — попросить кого-либо сделать что-либо.',
      ),
      scene(
        'Librarian',
        'That is precise. The message acknowledges the volunteers, and the catalogue supports restoring their credit. We can update the public display with a verified explanation, or host a small discussion about whose work disappears when an exhibition is shortened. The unknown handwriting can remain unknown.',
        [['Choose how to present the discovery.', 15]],
        'acknowledge|признавать вклад',
      ),
      scene(
        'Narrator',
        'You rewrite the sentence using "asked the printer to retain". The librarian accepts the corrected translation of the request, but the display team has already started uploading the booklet. You can request a reviewed addendum or leave your research in the library’s discovery file for later work.',
        [['Choose a responsible next step.', 16]],
        'addendum|дополнение к документу',
      ),
      scene(
        'Narrator',
        'You have enough evidence to explain the caption pattern and credit the volunteers. You do not have enough to name the pencilled-note writer. Visitors will see whichever presentation you choose, so its limits should be as visible as its conclusion.',
        [
          ['Publish an explanation with sources and limits.', 17],
          ['Arrange a discussion beside the original booklet.', 18],
        ],
        'limits|границы; ограничения',
      ),
      scene(
        'Librarian',
        'The original booklet will stay online unchanged as a historical document. A separate note can explain the missing credit without silently rewriting the source. If there is no time to review it today, your evidence can remain in the discovery file until another volunteer continues the work.',
        [
          ['Request a separately reviewed addendum.', 18],
          ['Archive the evidence for a future researcher.', 19],
        ],
        'silently|незаметно; без пояснений',
      ),
      end(
        'The online display includes a sourced explanation of the first-word pattern and names the volunteer group from the public catalogue. A final line states that the pencilled note’s author is unknown. The secret is smaller than a sensational headline, but the restored credit makes the history more complete.',
        'Имена возвращены',
        'Значок «Внимательный исследователь»',
        'sourced|подтверждённый источниками',
      ),
      end(
        'The library presents the booklet with a reviewed companion note and invites visitors to discuss the missing credit. A former reading-room volunteer brings a public photograph for a future display. Nobody claims it identifies the handwriting. Your careful language has opened a conversation rather than closed an uncertain case.',
        'Разговор на полях',
        'Значок «Хранитель контекста»',
        'companion note|сопроводительное примечание',
      ),
      end(
        'You file the captions, the catalogue reference and the editing instruction together, separating facts from unanswered questions. Tomorrow’s display proceeds without your theory. Weeks later, another volunteer can follow your reasoning without starting again. A message need not be completely solved to be responsibly preserved.',
        'След для следующего читателя',
        'Значок «Честная неопределённость»',
        'preserved|сохранённый',
      ),
    ],
  ),
];
