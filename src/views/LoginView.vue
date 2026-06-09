<script setup lang="ts">
const toLogin = () => window.location.href = `https://emos.best/link?uuid=56c3c5e7-f592-436f-88e0-bd9a4f8011cc&name=emos-music-upload&url=https://music.emos.best/upload`
</script>

<template>
  <main class="min-h-screen overflow-hidden bg-[#f7f1e8] font-[Inter,'PingFang_SC','Microsoft_YaHei',sans-serif] text-[#17130c] antialiased">
    <div
      class="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(24,169,153,0.16),transparent_32%),radial-gradient(circle_at_82%_12%,rgba(180,83,9,0.12),transparent_30%)]"
    />

    <section class="relative mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
      <div class="max-w-2xl">
        <p class="mb-6 inline-flex rounded-full border border-[#17130c]/10 bg-white/50 px-4 py-1 text-sm font-medium tracking-[0.18em] text-[#6d6252] backdrop-blur">
          EMOS MUSIC
        </p>

        <h1 class="text-5xl font-black leading-[0.95] tracking-[-0.075em] text-[#17130c] sm:text-7xl">
          <span class="block bg-gradient-to-r from-[#18a999] to-[#0f766e] bg-clip-text tracking-[-0.065em] text-transparent">
            歌曲上传
          </span>
        </h1>

        <p class="mt-8 max-w-xl text-lg font-medium leading-8 tracking-[-0.01em] text-[#6d6252]">
          共建曲库，让更多声音被听见。
        </p>

        <button
          class="mt-12 rounded-2xl bg-[#17130c] px-7 py-4 text-base font-bold tracking-[-0.01em] text-[#f8f1e3] transition hover:-translate-y-0.5 hover:bg-[#2c251c]"
          type="button"
          @click="toLogin"
        >
          通过 emos 登录
        </button>
      </div>
    </section>
  </main>
</template>
