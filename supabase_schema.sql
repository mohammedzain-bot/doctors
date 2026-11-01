-- ==============================================================================
-- SUPABASE POSTGRESQL SCHEMA FOR DOCTOR ENQUIRY AND CHAT SYSTEM
-- ==============================================================================
-- Run this script in the Supabase SQL Editor if you prefer hosting on Supabase.
-- Real-time subscriptions and Row Level Security (RLS) are fully configured.

-- 1. Create Conversations Table
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id TEXT NOT NULL,
    visitor_token TEXT NOT NULL,
    visitor_name TEXT DEFAULT '',
    visitor_phone TEXT DEFAULT '',
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'open', 'resolved')),
    admin_notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    last_message_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Messages Table
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'admin', 'system')),
    sender_name TEXT DEFAULT '',
    message_text TEXT NOT NULL,
    delivery_status TEXT DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'delivered', 'read')),
    created_at TIMESTAMPTZ DEFAULT now(),
    read_at TIMESTAMPTZ
);

-- 3. High-Performance Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_visitor ON public.conversations(visitor_id);
CREATE INDEX IF NOT EXISTS idx_conversations_token ON public.conversations(visitor_token);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON public.conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at ASC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 5. Row Level Security Policies
-- Authenticated admins can view and modify all conversations
CREATE POLICY "Admins full access to conversations"
    ON public.conversations
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Authenticated admins can view and modify all messages
CREATE POLICY "Admins full access to messages"
    ON public.messages
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Visitors can only access their specific conversation using their private token
CREATE POLICY "Visitors read own conversation"
    ON public.conversations
    FOR SELECT
    TO anon
    USING (visitor_token = current_setting('request.headers', true)::json->>'x-visitor-token');

CREATE POLICY "Visitors insert messages to own conversation"
    ON public.messages
    FOR INSERT
    TO anon
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
            AND c.visitor_token = current_setting('request.headers', true)::json->>'x-visitor-token'
        )
    );

CREATE POLICY "Visitors read messages from own conversation"
    ON public.messages
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
            AND c.visitor_token = current_setting('request.headers', true)::json->>'x-visitor-token'
        )
    );

-- 6. Enable Realtime Subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
