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
      cards: {
        Row: {
          created_at: string
          difficulty: number
          due_at: string
          id: string
          lapses: number
          last_review_at: string | null
          learning_step: number
          paused: boolean
          reps: number
          schedule_status: string
          scheduled_days: number
          stability: number
          stability_fast: number
          state: number
          user_id: string
          word_id: string
        }
        Insert: {
          created_at?: string
          difficulty?: number
          due_at?: string
          id?: string
          lapses?: number
          last_review_at?: string | null
          learning_step?: number
          paused?: boolean
          reps?: number
          schedule_status?: string
          scheduled_days?: number
          stability?: number
          stability_fast?: number
          state?: number
          user_id: string
          word_id: string
        }
        Update: {
          created_at?: string
          difficulty?: number
          due_at?: string
          id?: string
          lapses?: number
          last_review_at?: string | null
          learning_step?: number
          paused?: boolean
          reps?: number
          schedule_status?: string
          scheduled_days?: number
          stability?: number
          stability_fast?: number
          state?: number
          user_id?: string
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: true
            referencedRelation: "words"
            referencedColumns: ["id"]
          },
        ]
      }
      review_logs: {
        Row: {
          card_id: string
          id: string
          previous: Json
          rating: number
          reviewed_at: string
          revlog: Json
          user_id: string
          was_new: boolean
        }
        Insert: {
          card_id: string
          id?: string
          previous: Json
          rating: number
          reviewed_at?: string
          revlog: Json
          user_id: string
          was_new: boolean
        }
        Update: {
          card_id?: string
          id?: string
          previous?: Json
          rating?: number
          reviewed_at?: string
          revlog?: Json
          user_id?: string
          was_new?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "review_logs_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          new_cards_per_day: number
          updated_at: string
          user_id: string
        }
        Insert: {
          new_cards_per_day?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          new_cards_per_day?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      words: {
        Row: {
          context: string
          created_at: string
          id: string
          lang: Database["public"]["Enums"]["word_lang"]
          source: Database["public"]["Enums"]["word_source"]
          term: string
          translation: string
          user_id: string
        }
        Insert: {
          context?: string
          created_at?: string
          id?: string
          lang: Database["public"]["Enums"]["word_lang"]
          source?: Database["public"]["Enums"]["word_source"]
          term: string
          translation?: string
          user_id?: string
        }
        Update: {
          context?: string
          created_at?: string
          id?: string
          lang?: Database["public"]["Enums"]["word_lang"]
          source?: Database["public"]["Enums"]["word_source"]
          term?: string
          translation?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      new_cards_limit: { Args: never; Returns: number }
      review_card: {
        Args: {
          p_card_id: string
          p_day_start: string
          p_expected_reps: number
          p_next: Json
          p_rating: number
          p_revlog: Json
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
      undo_review: { Args: { p_log_id: string }; Returns: string }
    }
    Enums: {
      word_lang: "en" | "it"
      word_source: "manual" | "stremio" | "lesson" | "music"
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
    Enums: {
      word_lang: ["en", "it"],
      word_source: ["manual", "stremio", "lesson", "music"],
    },
  },
} as const

