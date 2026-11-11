export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      api_tokens: {
        Row: {
          created_at: string
          id: string
          label: string
          last_used_at: string | null
          token_hash: string
          token_hint: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          token_hash: string
          token_hint: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          token_hash?: string
          token_hint?: string
          user_id?: string
        }
        Relationships: []
      }
      cards: {
        Row: {
          created_at: string
          difficulty: number
          due_at: string
          id: string
          item_id: string
          kind: string
          lapses: number
          last_review_at: string | null
          learning_step: number
          reps: number
          schedule_status: string
          scheduled_days: number
          stability: number
          stability_fast: number
          state: number
          user_id: string
        }
        Insert: {
          created_at?: string
          difficulty?: number
          due_at?: string
          id?: string
          item_id: string
          kind: string
          lapses?: number
          last_review_at?: string | null
          learning_step?: number
          reps?: number
          schedule_status?: string
          scheduled_days?: number
          stability?: number
          stability_fast?: number
          state?: number
          user_id: string
        }
        Update: {
          created_at?: string
          difficulty?: number
          due_at?: string
          id?: string
          item_id?: string
          kind?: string
          lapses?: number
          last_review_at?: string | null
          learning_step?: number
          reps?: number
          schedule_status?: string
          scheduled_days?: number
          stability?: number
          stability_fast?: number
          state?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_item_id_user_id_fkey"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      encounters: {
        Row: {
          client_id: string | null
          created_at: string
          deleted_at: string | null
          form: string
          highlight: string
          id: string
          item_id: string
          origin: string
          position: Json
          seen_at: string
          sense: string
          sentence: string
          user_id: string
          work_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          deleted_at?: string | null
          form?: string
          highlight?: string
          id?: string
          item_id: string
          origin: string
          position?: Json
          seen_at?: string
          sense?: string
          sentence?: string
          user_id: string
          work_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          deleted_at?: string | null
          form?: string
          highlight?: string
          id?: string
          item_id?: string
          origin?: string
          position?: Json
          seen_at?: string
          sense?: string
          sentence?: string
          user_id?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "encounters_item_id_user_id_fkey"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "encounters_work_id_user_id_fkey"
            columns: ["work_id", "user_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      items: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          ipa: string
          language: string
          last_seen_at: string | null
          lemma: string
          note: string
          part_of_speech: string
          seen_count: number
          sense: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          ipa?: string
          language: string
          last_seen_at?: string | null
          lemma: string
          note?: string
          part_of_speech?: string
          seen_count?: number
          sense?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          ipa?: string
          language?: string
          last_seen_at?: string | null
          lemma?: string
          note?: string
          part_of_speech?: string
          seen_count?: number
          sense?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      review_logs: {
        Row: {
          card_id: string
          client_id: string | null
          id: string
          rating: number
          received_at: string
          reviewed_at: string
          user_id: string
        }
        Insert: {
          card_id: string
          client_id?: string | null
          id?: string
          rating: number
          received_at?: string
          reviewed_at: string
          user_id: string
        }
        Update: {
          card_id?: string
          client_id?: string | null
          id?: string
          rating?: number
          received_at?: string
          reviewed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_logs_card_id_user_id_fkey"
            columns: ["card_id", "user_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      user_settings: {
        Row: {
          native_language: string
          new_cards_per_day: number
          study_languages: unknown[]
          updated_at: string
          user_id: string
        }
        Insert: {
          native_language?: string
          new_cards_per_day?: number
          study_languages?: unknown[]
          updated_at?: string
          user_id: string
        }
        Update: {
          native_language?: string
          new_cards_per_day?: number
          study_languages?: unknown[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      works: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          kind: string
          language: string | null
          played_at: string | null
          ref_key: string | null
          refs: Json
          subtitle: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: string
          language?: string | null
          played_at?: string | null
          ref_key?: string | null
          refs?: Json
          subtitle?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          language?: string | null
          played_at?: string | null
          ref_key?: string | null
          refs?: Json
          subtitle?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      api_items: {
        Args: { p_language: string; p_token: string }
        Returns: {
          cards: Json
          id: string
          lemma: string
          sense: string
          status: string
        }[]
      }
      api_mark_seen: {
        Args: { p_language: string; p_lemmas: string[]; p_token: string }
        Returns: number
      }
      api_me: {
        Args: { p_token: string }
        Returns: {
          email: string
          native_language: string
          study_languages: string[]
        }[]
      }
      api_save_items: {
        Args: { p_items: Json; p_token: string }
        Returns: {
          card_due_at: string
          card_state: number
          created: boolean
          encounter_id: string
          item_id: string
          language: string
          lemma: string
        }[]
      }
      api_token_owner: { Args: { p_token: string }; Returns: string }
      open_work: { Args: { p_work: Json }; Returns: string }
      record_review: {
        Args: {
          p_card_id: string
          p_client_id?: string
          p_expected_reps: number
          p_next: Json
          p_rating: number
          p_reviewed_at: string
          p_unlock_produce: boolean
        }
        Returns: string
      }
      review_counts: {
        Args: { p_day_start: string }
        Returns: {
          due_now: number
          new_available: number
          new_done_today: number
          new_limit: number
          next_due_at: string
        }[]
      }
      save_items: {
        Args: { p_items: Json }
        Returns: {
          card_due_at: string
          card_state: number
          created: boolean
          encounter_id: string
          item_id: string
          language: string
          lemma: string
        }[]
      }
      save_items_for: {
        Args: { p_items: Json; p_user: string }
        Returns: {
          card_due_at: string
          card_state: number
          created: boolean
          encounter_id: string
          item_id: string
          language: string
          lemma: string
        }[]
      }
      undo_review: {
        Args: {
          p_drop_produce: boolean
          p_expected_reps: number
          p_log_id: string
          p_next: Json
        }
        Returns: string
      }
      work_for: { Args: { p_user: string; p_work: Json }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

