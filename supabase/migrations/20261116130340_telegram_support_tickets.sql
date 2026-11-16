-- Bot-only helpdesk. No Mini App profile is required and no client has table/RPC access.
CREATE TABLE public.support_tickets (
  ticket_no bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id bigint NOT NULL CHECK (telegram_id > 0),
  category text NOT NULL CHECK (category IN ('general','payment')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_owner ON public.support_tickets(telegram_id, ticket_no DESC);
CREATE INDEX support_tickets_queue ON public.support_tickets(status, updated_at);
CREATE TABLE public.support_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_no bigint NOT NULL REFERENCES public.support_tickets(ticket_no),
  author text NOT NULL CHECK (author IN ('user','admin')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_ticket ON public.support_messages(ticket_no, id DESC);
CREATE TABLE public.support_sessions (
  telegram_id bigint PRIMARY KEY CHECK (telegram_id > 0),
  ticket_no bigint REFERENCES public.support_tickets(ticket_no),
  category text NOT NULL CHECK (category IN ('general','payment')),
  expires_at timestamptz NOT NULL
);
CREATE INDEX support_sessions_ticket ON public.support_sessions(ticket_no);
CREATE TABLE public.support_updates (
  update_id bigint PRIMARY KEY CHECK (update_id >= 0),
  telegram_id bigint NOT NULL CHECK (telegram_id > 0),
  fingerprint text NOT NULL CHECK (length(fingerprint) = 64),
  handled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.support_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id bigint NOT NULL REFERENCES public.support_updates(update_id),
  slot integer NOT NULL CHECK (slot >= 0),
  chat_id bigint NOT NULL CHECK (chat_id > 0),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  staff_only boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease uuid,
  reserved_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(update_id, slot)
);
CREATE INDEX support_outbox_pending ON public.support_outbox(created_at) WHERE sent_at IS NULL;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['support_tickets','support_messages','support_sessions','support_updates','support_outbox'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role',t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.support_tickets_ticket_no_seq, public.support_messages_id_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.support_tickets_ticket_no_seq, public.support_messages_id_seq TO service_role;

-- This RPC is service-only: p_admin/p_admin_chats come exclusively from protected ADMIN_USER_IDS.
-- One transaction contains deduplication, ownership checks, messages and durable delivery jobs.
CREATE FUNCTION public.process_support_update(
  p_update bigint, p_actor bigint, p_fingerprint text, p_action text,
  p_text text, p_ticket bigint, p_admin boolean, p_admin_chats bigint[]
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE previous public.support_updates; session_row public.support_sessions;
  ticket public.support_tickets; reply text; item record; recipient bigint; slot_no integer := 0;
BEGIN
  IF p_actor <= 0 OR p_update < 0 OR length(p_fingerprint) <> 64 OR
    p_action NOT IN ('begin','payment','cancel','reset','append','list','view','reply','close','invalid') OR
    length(p_text) > 3000 OR cardinality(p_admin_chats) > 100 THEN
    RAISE EXCEPTION 'Invalid support request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('support-update:' || p_update,0));
  SELECT * INTO previous FROM public.support_updates WHERE update_id=p_update;
  IF FOUND THEN
    IF previous.telegram_id <> p_actor OR previous.fingerprint <> p_fingerprint THEN
      RAISE EXCEPTION 'Support update conflict';
    END IF;
    RETURN previous.handled;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('support-actor:' || p_actor,0));
  SELECT * INTO session_row FROM public.support_sessions WHERE telegram_id=p_actor AND expires_at>now();
  -- Ordinary bot messages outside an active conversation are not retained.
  IF p_action='append' AND session_row.telegram_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.support_updates(update_id,telegram_id,fingerprint) VALUES(p_update,p_actor,p_fingerprint);
  IF p_action='invalid' THEN
    reply := 'Нужен текст до 3000 символов. Команды: /support, /tickets, /ticket НОМЕР, /close НОМЕР, /cancel. Для поддержки: /reply НОМЕР текст.';
  ELSIF p_action IN ('reset','cancel') THEN
    DELETE FROM public.support_sessions WHERE telegram_id=p_actor;
    IF p_action='reset' THEN
      UPDATE public.support_updates SET handled=false WHERE update_id=p_update;
      RETURN false;
    END IF;
    reply := 'Режим поддержки выключен. Заявки сохранены. /tickets — мои заявки, /support — новая.';
  ELSIF p_action IN ('begin','payment') THEN
    INSERT INTO public.support_sessions(telegram_id,category,expires_at)
      VALUES(p_actor,CASE WHEN p_action='payment' THEN 'payment' ELSE 'general' END,now()+interval '24 hours')
      ON CONFLICT(telegram_id) DO UPDATE SET ticket_no=NULL,category=excluded.category,expires_at=excluded.expires_at;
    reply := CASE WHEN p_action='payment' THEN 'Поддержка покупок.' ELSE 'Ошибки, баги и предложения.' END ||
      E'\n\nОпиши обращение одним текстовым сообщением (до 3000 символов). Мы создадим тикет и ответим здесь, в боте. Для ошибки укажи экран и шаги; для покупки — дату и тариф. Не отправляй пароли, токены и данные карты.\n\n/cancel — отменить.';
  ELSIF p_action='list' THEN
    reply := CASE WHEN p_admin THEN 'Открытые заявки поддержки:' ELSE 'Твои последние заявки:' END;
    FOR item IN SELECT * FROM public.support_tickets
      WHERE (p_admin AND status<>'closed') OR (NOT p_admin AND telegram_id=p_actor)
      ORDER BY ticket_no DESC LIMIT 10 LOOP
      reply := reply || E'\n#' || item.ticket_no || ' · ' ||
        CASE item.status WHEN 'open' THEN 'ожидает ответа' WHEN 'answered' THEN 'есть ответ' ELSE 'закрыта' END ||
        ' · /ticket ' || item.ticket_no;
    END LOOP;
    IF NOT FOUND THEN reply := reply || E'\nПока нет заявок. /support — создать.'; END IF;
    IF p_admin THEN reply := reply || E'\n\n/reply НОМЕР текст — ответить\n/close НОМЕР — закрыть'; END IF;
  ELSE
    IF p_action='append' AND session_row.ticket_no IS NULL THEN
      IF length(trim(p_text))=0 THEN
        reply := 'Для заявки нужен текст. Опиши проблему сообщением до 3000 символов. /cancel — отменить.';
      ELSIF (SELECT count(*) FROM public.support_tickets WHERE telegram_id=p_actor AND created_at>now()-interval '24 hours')>=3 OR
        (SELECT count(*) FROM public.support_tickets WHERE telegram_id=p_actor AND status<>'closed')>=3 THEN
        reply := 'Лимит: до трёх новых заявок за 24 часа и трёх открытых одновременно. Продолжи существующую: /tickets.';
      ELSE
        INSERT INTO public.support_tickets(telegram_id,category) VALUES(p_actor,session_row.category) RETURNING * INTO ticket;
        UPDATE public.support_sessions SET ticket_no=ticket.ticket_no,expires_at=now()+interval '24 hours' WHERE telegram_id=p_actor;
      END IF;
    ELSE
      SELECT * INTO ticket FROM public.support_tickets
        WHERE ticket_no=CASE WHEN p_action='append' THEN session_row.ticket_no ELSE p_ticket END
        AND (telegram_id=p_actor OR p_admin) FOR UPDATE;
      IF NOT FOUND THEN reply := 'Заявка не найдена или недоступна. /tickets — доступные заявки.'; END IF;
    END IF;
    IF ticket.ticket_no IS NOT NULL AND reply IS NULL THEN
      IF p_action='view' THEN
        reply := 'Тикет #' || ticket.ticket_no || CASE ticket.status WHEN 'closed' THEN ' · закрыт' WHEN 'answered' THEN ' · есть ответ' ELSE ' · ожидает ответа' END;
        INSERT INTO public.support_outbox(update_id,slot,chat_id,body,staff_only) VALUES(p_update,slot_no,p_actor,reply,p_admin); slot_no:=slot_no+1;
        FOR item IN SELECT * FROM (SELECT * FROM public.support_messages WHERE ticket_no=ticket.ticket_no ORDER BY id DESC LIMIT 5) recent ORDER BY id LOOP
          INSERT INTO public.support_outbox(update_id,slot,chat_id,body,staff_only) VALUES(p_update,slot_no,p_actor,
            CASE item.author WHEN 'admin' THEN 'Поддержка' ELSE 'Пользователь' END || ' · ' || item.created_at::date || E'\n' || item.body,p_admin);
          slot_no:=slot_no+1;
        END LOOP;
        IF NOT p_admin AND ticket.status<>'closed' THEN
          INSERT INTO public.support_sessions(telegram_id,ticket_no,category,expires_at)
            VALUES(p_actor,ticket.ticket_no,ticket.category,now()+interval '24 hours')
            ON CONFLICT(telegram_id) DO UPDATE SET ticket_no=excluded.ticket_no,category=excluded.category,expires_at=excluded.expires_at;
        END IF;
        reply := CASE WHEN ticket.status='closed' THEN '/support — новая заявка.'
          WHEN p_admin THEN '/reply ' || ticket.ticket_no || ' текст — ответить; /close ' || ticket.ticket_no || ' — закрыть.'
          ELSE 'Следующее сообщение добавится в этот тикет. /close ' || ticket.ticket_no || ' — закрыть; /cancel — выйти из переписки.' END;
      ELSIF p_action='close' THEN
        IF ticket.status='closed' THEN reply := 'Тикет #' || ticket.ticket_no || ' уже закрыт.';
        ELSE
          UPDATE public.support_tickets SET status='closed',updated_at=now() WHERE ticket_no=ticket.ticket_no;
          reply := 'Тикет #' || ticket.ticket_no || ' закрыт. /support — новая заявка.';
          IF p_admin AND ticket.telegram_id<>p_actor THEN
            INSERT INTO public.support_outbox(update_id,slot,chat_id,body) VALUES(p_update,slot_no,ticket.telegram_id,reply); slot_no:=slot_no+1;
          END IF;
        END IF;
      ELSIF p_action='reply' AND NOT p_admin THEN reply := 'Команда доступна только поддержке. /tickets — твои заявки.';
      ELSIF ticket.status='closed' THEN
        DELETE FROM public.support_sessions WHERE telegram_id=p_actor;
        reply := 'Тикет закрыт. /support — создать новый, /tickets — история.';
      ELSIF length(trim(p_text))=0 THEN reply := 'Нужно текстовое сообщение до 3000 символов.';
      ELSIF (SELECT count(*) FROM public.support_messages m JOIN public.support_tickets t USING(ticket_no)
        WHERE t.telegram_id=p_actor AND m.author='user' AND m.created_at>now()-interval '1 hour') >= 20 AND NOT p_admin THEN
        reply := 'Слишком много сообщений. Подожди час и продолжи: /ticket ' || ticket.ticket_no;
      ELSE
        INSERT INTO public.support_messages(ticket_no,author,body) VALUES(ticket.ticket_no,CASE WHEN p_action='reply' THEN 'admin' ELSE 'user' END,p_text);
        UPDATE public.support_tickets SET status=CASE WHEN p_action='reply' THEN 'answered' ELSE 'open' END,updated_at=now() WHERE ticket_no=ticket.ticket_no;
        IF p_action='reply' THEN
          INSERT INTO public.support_outbox(update_id,slot,chat_id,body) VALUES(p_update,slot_no,ticket.telegram_id,'Поддержка · тикет #' || ticket.ticket_no || E'\n\n' || p_text || E'\n\n/ticket ' || ticket.ticket_no || ' — продолжить переписку.'); slot_no:=slot_no+1;
          reply := 'Ответ сохранён для тикета #' || ticket.ticket_no || '.';
        ELSE
          FOREACH recipient IN ARRAY p_admin_chats LOOP
            INSERT INTO public.support_outbox(update_id,slot,chat_id,body,staff_only) VALUES(p_update,slot_no,recipient,
              'Поддержка Voklumi · тикет #' || ticket.ticket_no || CASE ticket.category WHEN 'payment' THEN ' · покупки' ELSE '' END ||
              E'\n\n' || p_text || E'\n\n/reply ' || ticket.ticket_no || ' текст — ответить' || E'\n/ticket ' || ticket.ticket_no || ' — история',true); slot_no:=slot_no+1;
          END LOOP;
          reply := 'Сообщение сохранено в тикете #' || ticket.ticket_no || E'. Поддержка ответит в этом боте.\nМожно добавить ещё сообщение. /cancel — выйти, /tickets — мои заявки.';
        END IF;
      END IF;
    END IF;
  END IF;
  IF reply IS NOT NULL THEN INSERT INTO public.support_outbox(update_id,slot,chat_id,body,staff_only) VALUES(p_update,slot_no,p_actor,reply,p_admin); END IF;
  RETURN true;
END $$;

CREATE FUNCTION public.claim_support_delivery(p_update bigint DEFAULT NULL)
RETURNS SETOF public.support_outbox LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.support_outbox SET lease=gen_random_uuid(),reserved_until=now()+interval '60 seconds',attempts=attempts+1
  WHERE id=(SELECT id FROM public.support_outbox
    WHERE sent_at IS NULL AND (reserved_until IS NULL OR reserved_until<now()) AND (p_update IS NULL OR update_id=p_update)
    ORDER BY created_at, update_id, slot FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING *
$$;
CREATE FUNCTION public.complete_support_delivery(p_id uuid,p_lease uuid,p_sent boolean)
RETURNS void LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.support_outbox SET sent_at=CASE WHEN p_sent THEN now() ELSE NULL END,lease=NULL,reserved_until=CASE WHEN p_sent THEN NULL ELSE now()+make_interval(secs => least(3600,30*power(2,least(attempts,7)))::integer) END
  WHERE id=p_id AND lease=p_lease
$$;
CREATE FUNCTION public.support_database_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('version','support-tickets-v1','ready',
    (SELECT count(*)=5 AND bool_and(relrowsecurity) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('support_tickets','support_messages','support_sessions','support_updates','support_outbox')))
$$;
REVOKE ALL ON FUNCTION public.process_support_update(bigint,bigint,text,text,text,bigint,boolean,bigint[]),
  public.claim_support_delivery(bigint),public.complete_support_delivery(uuid,uuid,boolean),public.support_database_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_support_update(bigint,bigint,text,text,text,bigint,boolean,bigint[]),
  public.claim_support_delivery(bigint),public.complete_support_delivery(uuid,uuid,boolean),public.support_database_status() TO service_role;
