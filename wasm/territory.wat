(module
 (type $0 (func))
 (type $1 (func (param i32) (result i32)))
 (type $2 (func (param i32 i32 i32 i32 i32 i32)))
 (type $3 (func (param i32 i32 i32 i32)))
 (type $4 (func (param i32 i32 i32 i32 i32 i32 i32)))
 (type $5 (func (param i32)))
 (type $6 (func (param i32 i32 i32 i32 i32)))
 (import "env" "memory" (memory $0 0))
 (global $wasm/assembly/territory/NEVER i32 (i32.const 2147483647))
 (global $wasm/assembly/territory/D_WORDS i32 (i32.const 0))
 (global $wasm/assembly/territory/D_CELLS i32 (i32.const 1))
 (global $wasm/assembly/territory/D_NT i32 (i32.const 2))
 (global $wasm/assembly/territory/D_NP i32 (i32.const 3))
 (global $wasm/assembly/territory/D_TURNS i32 (i32.const 4))
 (global $wasm/assembly/territory/D_TMIN i32 (i32.const 5))
 (global $wasm/assembly/territory/D_AS_TEAM i32 (i32.const 6))
 (global $wasm/assembly/territory/D_DOMAIN i32 (i32.const 7))
 (global $wasm/assembly/territory/D_DECISIVE i32 (i32.const 8))
 (global $wasm/assembly/territory/D_RANKS i32 (i32.const 9))
 (global $wasm/assembly/territory/D_EARLIEST i32 (i32.const 10))
 (global $wasm/assembly/territory/D_ENT_TEAM i32 (i32.const 11))
 (global $wasm/assembly/territory/D_TRAIL_SLOTS i32 (i32.const 12))
 (global $wasm/assembly/territory/D_PIECE_SLOTS i32 (i32.const 13))
 (global $wasm/assembly/territory/D_OURS_BOARD i32 (i32.const 14))
 (global $wasm/assembly/territory/D_THEIRS_BOARD i32 (i32.const 15))
 (global $wasm/assembly/territory/D_SCRATCH i32 (i32.const 16))
 (global $wasm/assembly/territory/D_OUT_OURS i32 (i32.const 17))
 (global $wasm/assembly/territory/D_OUT_THEIRS i32 (i32.const 18))
 (global $wasm/assembly/territory/D_LEN i32 (i32.const 19))
 (global $wasm/assembly/territory/S_WORDS i32 (i32.const 0))
 (global $wasm/assembly/territory/S_NT i32 (i32.const 1))
 (global $wasm/assembly/territory/S_NTEAMS i32 (i32.const 2))
 (global $wasm/assembly/territory/S_TURN i32 (i32.const 3))
 (global $wasm/assembly/territory/S_NEED_DECISIVE i32 (i32.const 4))
 (global $wasm/assembly/territory/S_FRONT_ROWS i32 (i32.const 5))
 (global $wasm/assembly/territory/S_ENT_MINE i32 (i32.const 6))
 (global $wasm/assembly/territory/S_ENT_HELD i32 (i32.const 7))
 (global $wasm/assembly/territory/S_ENT_TEAM i32 (i32.const 8))
 (global $wasm/assembly/territory/S_TRAIL_SLOTS i32 (i32.const 9))
 (global $wasm/assembly/territory/S_TEAM_LIST i32 (i32.const 10))
 (global $wasm/assembly/territory/S_SEEN_ROWS i32 (i32.const 11))
 (global $wasm/assembly/territory/S_MULTI_ROWS i32 (i32.const 12))
 (global $wasm/assembly/territory/S_PLANE_ROWS i32 (i32.const 13))
 (global $wasm/assembly/territory/S_OUR_CUM i32 (i32.const 14))
 (global $wasm/assembly/territory/S_THEIR_CUM i32 (i32.const 15))
 (global $wasm/assembly/territory/S_OUR_STEP i32 (i32.const 16))
 (global $wasm/assembly/territory/S_THEIR_STEP i32 (i32.const 17))
 (global $wasm/assembly/territory/S_OURS_BOARD i32 (i32.const 18))
 (global $wasm/assembly/territory/S_THEIRS_BOARD i32 (i32.const 19))
 (global $wasm/assembly/territory/S_COVERED_PREV i32 (i32.const 20))
 (global $wasm/assembly/territory/S_NEW_T i32 (i32.const 21))
 (global $wasm/assembly/territory/S_HIT i32 (i32.const 22))
 (global $wasm/assembly/territory/S_OTHERS i32 (i32.const 23))
 (global $wasm/assembly/territory/S_DECISIVE i32 (i32.const 24))
 (global $wasm/assembly/territory/S_LEN i32 (i32.const 25))
 (export "NEVER" (global $wasm/assembly/territory/NEVER))
 (export "D_WORDS" (global $wasm/assembly/territory/D_WORDS))
 (export "D_CELLS" (global $wasm/assembly/territory/D_CELLS))
 (export "D_NT" (global $wasm/assembly/territory/D_NT))
 (export "D_NP" (global $wasm/assembly/territory/D_NP))
 (export "D_TURNS" (global $wasm/assembly/territory/D_TURNS))
 (export "D_TMIN" (global $wasm/assembly/territory/D_TMIN))
 (export "D_AS_TEAM" (global $wasm/assembly/territory/D_AS_TEAM))
 (export "D_DOMAIN" (global $wasm/assembly/territory/D_DOMAIN))
 (export "D_DECISIVE" (global $wasm/assembly/territory/D_DECISIVE))
 (export "D_RANKS" (global $wasm/assembly/territory/D_RANKS))
 (export "D_EARLIEST" (global $wasm/assembly/territory/D_EARLIEST))
 (export "D_ENT_TEAM" (global $wasm/assembly/territory/D_ENT_TEAM))
 (export "D_TRAIL_SLOTS" (global $wasm/assembly/territory/D_TRAIL_SLOTS))
 (export "D_PIECE_SLOTS" (global $wasm/assembly/territory/D_PIECE_SLOTS))
 (export "D_OURS_BOARD" (global $wasm/assembly/territory/D_OURS_BOARD))
 (export "D_THEIRS_BOARD" (global $wasm/assembly/territory/D_THEIRS_BOARD))
 (export "D_SCRATCH" (global $wasm/assembly/territory/D_SCRATCH))
 (export "D_OUT_OURS" (global $wasm/assembly/territory/D_OUT_OURS))
 (export "D_OUT_THEIRS" (global $wasm/assembly/territory/D_OUT_THEIRS))
 (export "D_LEN" (global $wasm/assembly/territory/D_LEN))
 (export "displace" (func $wasm/assembly/territory/displace))
 (export "stampDecisive" (func $wasm/assembly/territory/stampDecisive))
 (export "stampFronts" (func $wasm/assembly/territory/stampFronts))
 (export "S_WORDS" (global $wasm/assembly/territory/S_WORDS))
 (export "S_NT" (global $wasm/assembly/territory/S_NT))
 (export "S_NTEAMS" (global $wasm/assembly/territory/S_NTEAMS))
 (export "S_TURN" (global $wasm/assembly/territory/S_TURN))
 (export "S_NEED_DECISIVE" (global $wasm/assembly/territory/S_NEED_DECISIVE))
 (export "S_FRONT_ROWS" (global $wasm/assembly/territory/S_FRONT_ROWS))
 (export "S_ENT_MINE" (global $wasm/assembly/territory/S_ENT_MINE))
 (export "S_ENT_HELD" (global $wasm/assembly/territory/S_ENT_HELD))
 (export "S_ENT_TEAM" (global $wasm/assembly/territory/S_ENT_TEAM))
 (export "S_TRAIL_SLOTS" (global $wasm/assembly/territory/S_TRAIL_SLOTS))
 (export "S_TEAM_LIST" (global $wasm/assembly/territory/S_TEAM_LIST))
 (export "S_SEEN_ROWS" (global $wasm/assembly/territory/S_SEEN_ROWS))
 (export "S_MULTI_ROWS" (global $wasm/assembly/territory/S_MULTI_ROWS))
 (export "S_PLANE_ROWS" (global $wasm/assembly/territory/S_PLANE_ROWS))
 (export "S_OUR_CUM" (global $wasm/assembly/territory/S_OUR_CUM))
 (export "S_THEIR_CUM" (global $wasm/assembly/territory/S_THEIR_CUM))
 (export "S_OUR_STEP" (global $wasm/assembly/territory/S_OUR_STEP))
 (export "S_THEIR_STEP" (global $wasm/assembly/territory/S_THEIR_STEP))
 (export "S_OURS_BOARD" (global $wasm/assembly/territory/S_OURS_BOARD))
 (export "S_THEIRS_BOARD" (global $wasm/assembly/territory/S_THEIRS_BOARD))
 (export "S_COVERED_PREV" (global $wasm/assembly/territory/S_COVERED_PREV))
 (export "S_NEW_T" (global $wasm/assembly/territory/S_NEW_T))
 (export "S_HIT" (global $wasm/assembly/territory/S_HIT))
 (export "S_OTHERS" (global $wasm/assembly/territory/S_OTHERS))
 (export "S_DECISIVE" (global $wasm/assembly/territory/S_DECISIVE))
 (export "S_LEN" (global $wasm/assembly/territory/S_LEN))
 (export "sweepTurn" (func $wasm/assembly/territory/sweepTurn))
 (export "foldPlanes" (func $wasm/assembly/territory/foldPlanes))
 (export "countSides" (func $wasm/assembly/territory/countSides))
 (export "memory" (memory $0))
 (export "_start" (func $~start))
 (func $~start
 )
 (func $wasm/assembly/territory/sweepTurn (param $0 i32) (result i32)
  (local $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i32)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  (local $25 i32)
  (local $26 i32)
  (local $27 i32)
  (local $28 i32)
  (local $29 i32)
  (local $30 i32)
  (local $31 i32)
  (local $32 i32)
  local.get $0
  i32.load
  local.set $3
  local.get $0
  i32.load offset=4
  local.set $5
  local.get $0
  i32.load offset=8
  local.set $22
  local.get $0
  i32.load offset=12
  local.set $15
  local.get $0
  i32.load offset=16
  local.get $0
  i32.load offset=20
  local.set $6
  local.get $0
  i32.load offset=24
  local.set $23
  local.get $0
  i32.load offset=28
  local.set $11
  local.get $0
  i32.load offset=32
  local.set $12
  local.get $0
  i32.load offset=36
  local.set $7
  local.get $0
  i32.load offset=40
  local.set $24
  local.get $0
  i32.load offset=44
  local.set $13
  local.get $0
  i32.load offset=48
  local.set $14
  local.get $0
  i32.load offset=52
  local.set $17
  local.get $0
  i32.load offset=56
  local.set $25
  local.get $0
  i32.load offset=60
  local.set $26
  local.get $0
  i32.const -64
  i32.sub
  i32.load
  local.set $19
  local.get $0
  i32.load offset=68
  local.set $20
  local.get $0
  i32.load offset=72
  local.set $27
  local.get $0
  i32.load offset=76
  local.set $28
  local.get $0
  i32.load offset=80
  local.set $29
  local.get $0
  i32.load offset=84
  local.set $4
  local.get $0
  i32.load offset=88
  local.set $8
  local.get $0
  i32.load offset=92
  local.set $9
  local.get $0
  i32.load offset=96
  local.set $18
  loop $for-loop|0
   local.get $1
   local.get $3
   i32.lt_s
   if
    local.get $1
    i32.const 2
    i32.shl
    local.tee $0
    local.get $19
    i32.add
    i32.const 0
    i32.store
    local.get $0
    local.get $20
    i32.add
    i32.const 0
    i32.store
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $for-loop|0
   end
  end
  i32.const 0
  local.set $1
  loop $for-loop|1
   local.get $1
   local.get $5
   i32.lt_s
   if
    local.get $1
    i32.const 2
    i32.shl
    local.tee $0
    local.get $7
    i32.add
    i32.load
    local.set $21
    local.get $0
    local.get $6
    i32.add
    i32.load
    local.tee $30
    if
     local.get $19
     local.get $20
     local.get $21
     local.get $23
     i32.add
     i32.load8_u
     i32.const 1
     i32.eq
     select
     local.set $31
     i32.const 0
     local.set $0
     loop $for-loop|2
      local.get $0
      local.get $3
      i32.lt_s
      if
       local.get $31
       local.get $0
       i32.const 2
       i32.shl
       local.tee $32
       i32.add
       local.tee $21
       local.get $21
       i32.load
       local.get $30
       local.get $32
       i32.add
       i32.load
       i32.or
       i32.store
       local.get $0
       i32.const 1
       i32.add
       local.set $0
       br $for-loop|2
      end
     end
    end
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $for-loop|1
   end
  end
  i32.const 0
  local.set $0
  loop $for-loop|3
   local.get $0
   local.get $3
   i32.lt_s
   if
    local.get $25
    local.get $0
    i32.const 2
    i32.shl
    local.tee $1
    i32.add
    local.tee $21
    i32.load
    local.get $1
    local.get $19
    i32.add
    i32.load
    i32.or
    local.set $23
    local.get $1
    local.get $26
    i32.add
    local.tee $30
    i32.load
    local.get $1
    local.get $20
    i32.add
    i32.load
    i32.or
    local.set $31
    local.get $21
    local.get $23
    i32.store
    local.get $30
    local.get $31
    i32.store
    local.get $1
    local.get $27
    i32.add
    local.tee $21
    local.get $21
    i32.load
    local.get $23
    local.get $31
    i32.const -1
    i32.xor
    i32.and
    i32.or
    i32.store
    local.get $1
    local.get $28
    i32.add
    local.tee $1
    local.get $1
    i32.load
    local.get $31
    local.get $23
    i32.const -1
    i32.xor
    i32.and
    i32.or
    i32.store
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|3
   end
  end
  i32.const 0
  local.set $1
  loop $for-loop|4
   local.get $1
   local.get $3
   i32.lt_s
   if
    local.get $29
    local.get $1
    i32.const 2
    i32.shl
    local.tee $0
    i32.add
    local.tee $21
    i32.load
    local.set $23
    local.get $0
    local.get $4
    i32.add
    local.get $0
    local.get $20
    i32.add
    i32.load
    local.get $23
    local.get $0
    local.get $19
    i32.add
    i32.load
    i32.or
    i32.or
    local.tee $0
    local.get $23
    i32.const -1
    i32.xor
    i32.and
    local.tee $23
    i32.store
    local.get $21
    local.get $0
    i32.store
    local.get $2
    local.get $23
    i32.or
    local.set $2
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $for-loop|4
   end
  end
  local.get $2
  i32.eqz
  if
   i32.const 0
   return
  end
  loop $for-loop|5
   local.get $10
   local.get $22
   i32.lt_s
   if
    local.get $24
    local.get $10
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $19
    i32.const 2
    i32.shl
    local.tee $0
    local.get $13
    i32.add
    i32.load
    local.set $20
    local.get $0
    local.get $14
    i32.add
    i32.load
    local.set $21
    i32.const 0
    local.set $1
    loop $for-loop|6
     local.get $1
     local.get $3
     i32.lt_s
     if
      local.get $1
      i32.const 2
      i32.shl
      local.tee $0
      local.get $20
      i32.add
      i32.const 0
      i32.store
      local.get $0
      local.get $21
      i32.add
      i32.const 0
      i32.store
      local.get $1
      i32.const 1
      i32.add
      local.set $1
      br $for-loop|6
     end
    end
    i32.const 0
    local.set $0
    loop $for-loop|7
     local.get $0
     local.get $5
     i32.lt_s
     if
      block $for-continue|7
       local.get $7
       local.get $0
       i32.const 2
       i32.shl
       i32.add
       i32.load
       local.tee $1
       local.get $11
       i32.add
       i32.load8_u
       i32.const 1
       i32.eq
       if (result i32)
        local.get $12
        local.get $1
        i32.const 2
        i32.shl
        i32.add
        i32.load
        local.get $19
        i32.eq
       else
        i32.const 0
       end
       br_if $for-continue|7
       local.get $6
       local.get $0
       i32.const 2
       i32.shl
       i32.add
       i32.load
       local.tee $1
       i32.eqz
       br_if $for-continue|7
       i32.const 0
       local.set $2
       loop $for-loop|8
        local.get $2
        local.get $3
        i32.lt_s
        if
         local.get $1
         local.get $2
         i32.const 2
         i32.shl
         local.tee $23
         i32.add
         i32.load
         local.get $4
         local.get $23
         i32.add
         i32.load
         i32.and
         local.set $25
         local.get $21
         local.get $23
         i32.add
         local.tee $26
         local.get $26
         i32.load
         local.get $25
         local.get $20
         local.get $23
         i32.add
         local.tee $23
         i32.load
         i32.and
         i32.or
         i32.store
         local.get $23
         local.get $23
         i32.load
         local.get $25
         i32.or
         i32.store
         local.get $2
         i32.const 1
         i32.add
         local.set $2
         br $for-loop|8
        end
       end
      end
      local.get $0
      i32.const 1
      i32.add
      local.set $0
      br $for-loop|7
     end
    end
    local.get $10
    i32.const 1
    i32.add
    local.set $10
    br $for-loop|5
   end
  end
  i32.const 0
  local.set $1
  loop $for-loop|9
   local.get $1
   local.get $5
   i32.lt_s
   if
    local.get $1
    i32.const 2
    i32.shl
    local.tee $0
    local.get $7
    i32.add
    i32.load
    local.set $2
    local.get $0
    local.get $6
    i32.add
    i32.load
    local.tee $10
    if
     local.get $12
     local.get $2
     i32.const 2
     i32.shl
     i32.add
     i32.load
     i32.const 2
     i32.shl
     local.tee $0
     local.get $13
     i32.add
     i32.load
     local.set $19
     local.get $0
     local.get $14
     i32.add
     i32.load
     local.set $20
     i32.const 0
     local.set $0
     loop $for-loop|10
      local.get $0
      local.get $3
      i32.lt_s
      if
       local.get $0
       i32.const 2
       i32.shl
       local.tee $21
       local.get $8
       i32.add
       local.get $10
       local.get $21
       i32.add
       i32.load
       local.get $4
       local.get $21
       i32.add
       i32.load
       i32.and
       i32.store
       local.get $0
       i32.const 1
       i32.add
       local.set $0
       br $for-loop|10
      end
     end
     local.get $2
     local.get $11
     i32.add
     i32.load8_u
     i32.const 1
     i32.eq
     if
      i32.const 0
      local.set $0
      loop $for-loop|11
       local.get $0
       local.get $3
       i32.lt_s
       if
        local.get $0
        i32.const 2
        i32.shl
        local.tee $2
        local.get $9
        i32.add
        local.get $2
        local.get $19
        i32.add
        i32.load
        i32.store
        local.get $0
        i32.const 1
        i32.add
        local.set $0
        br $for-loop|11
       end
      end
     else
      i32.const 0
      local.set $0
      loop $for-loop|12
       local.get $0
       local.get $3
       i32.lt_s
       if
        local.get $8
        local.get $0
        i32.const 2
        i32.shl
        local.tee $2
        i32.add
        i32.load
        local.set $10
        local.get $2
        local.get $9
        i32.add
        local.get $2
        local.get $19
        i32.add
        i32.load
        local.get $10
        i32.const -1
        i32.xor
        i32.and
        local.get $2
        local.get $20
        i32.add
        i32.load
        local.get $10
        i32.and
        i32.or
        i32.store
        local.get $0
        i32.const 1
        i32.add
        local.set $0
        br $for-loop|12
       end
      end
     end
     local.get $17
     local.get $1
     i32.const 2
     i32.shl
     i32.add
     i32.load
     local.set $2
     i32.const 0
     local.set $0
     loop $for-loop|13
      local.get $0
      local.get $3
      i32.lt_s
      if
       local.get $2
       local.get $0
       i32.const 2
       i32.shl
       local.tee $10
       i32.add
       local.tee $19
       local.get $19
       i32.load
       local.get $8
       local.get $10
       i32.add
       i32.load
       local.get $9
       local.get $10
       i32.add
       i32.load
       i32.const -1
       i32.xor
       i32.and
       i32.or
       i32.store
       local.get $0
       i32.const 1
       i32.add
       local.set $0
       br $for-loop|13
      end
     end
    end
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $for-loop|9
   end
  end
  if
   i32.const 0
   local.set $0
   loop $for-loop|00
    local.get $0
    local.get $3
    i32.lt_s
    if
     local.get $4
     local.get $0
     i32.const 2
     i32.shl
     i32.add
     i32.load
     local.tee $1
     if
      local.get $0
      i32.const 5
      i32.shl
      local.set $2
      loop $while-continue|1
       local.get $1
       if
        local.get $18
        local.get $2
        local.get $1
        i32.ctz
        i32.add
        i32.const 2
        i32.shl
        i32.add
        local.get $15
        i32.store
        local.get $1
        local.get $1
        i32.const 1
        i32.sub
        i32.and
        local.set $1
        br $while-continue|1
       end
      end
     end
     local.get $0
     i32.const 1
     i32.add
     local.set $0
     br $for-loop|00
    end
   end
  end
  i32.const 1
 )
 (func $wasm/assembly/territory/stampFronts (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  loop $for-loop|0
   local.get $3
   local.get $6
   i32.gt_s
   if
    local.get $5
    local.get $6
    i32.const 2
    i32.shl
    i32.add
    i32.const 2147483647
    i32.store
    local.get $6
    i32.const 1
    i32.add
    local.set $6
    br $for-loop|0
   end
  end
  i32.const 0
  local.set $3
  loop $for-loop|1
   local.get $1
   local.get $3
   i32.gt_s
   if
    local.get $3
    local.get $4
    i32.add
    local.set $8
    local.get $0
    local.get $2
    local.get $3
    i32.mul
    i32.const 2
    i32.shl
    i32.add
    local.set $9
    i32.const 0
    local.set $6
    loop $for-loop|2
     local.get $2
     local.get $6
     i32.gt_s
     if
      local.get $9
      local.get $6
      i32.const 2
      i32.shl
      i32.add
      i32.load
      local.tee $7
      if
       local.get $6
       i32.const 5
       i32.shl
       local.set $10
       loop $while-continue|3
        local.get $7
        if
         local.get $5
         local.get $10
         local.get $7
         i32.ctz
         i32.add
         i32.const 2
         i32.shl
         i32.add
         local.tee $11
         i32.load
         local.get $8
         i32.gt_s
         if
          local.get $11
          local.get $8
          i32.store
         end
         local.get $7
         local.get $7
         i32.const 1
         i32.sub
         i32.and
         local.set $7
         br $while-continue|3
        end
       end
      end
      local.get $6
      i32.const 1
      i32.add
      local.set $6
      br $for-loop|2
     end
    end
    local.get $3
    i32.const 1
    i32.add
    local.set $3
    br $for-loop|1
   end
  end
 )
 (func $wasm/assembly/territory/stampDecisive (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  loop $for-loop|0
   local.get $1
   local.get $5
   i32.gt_s
   if
    local.get $0
    local.get $5
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $4
    if
     local.get $5
     i32.const 5
     i32.shl
     local.set $6
     loop $while-continue|1
      local.get $4
      if
       local.get $2
       local.get $6
       local.get $4
       i32.ctz
       i32.add
       i32.const 2
       i32.shl
       i32.add
       local.get $3
       i32.store
       local.get $4
       local.get $4
       i32.const 1
       i32.sub
       i32.and
       local.set $4
       br $while-continue|1
      end
     end
    end
    local.get $5
    i32.const 1
    i32.add
    local.set $5
    br $for-loop|0
   end
  end
 )
 (func $wasm/assembly/territory/foldPlanes (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32) (param $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  loop $for-loop|0
   local.get $1
   local.get $7
   i32.gt_s
   if
    local.get $0
    local.get $7
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.set $11
    i32.const 0
    local.set $9
    i32.const 0
    local.set $8
    loop $for-loop|1
     local.get $2
     local.get $8
     i32.gt_s
     if
      local.get $9
      local.get $11
      local.get $8
      i32.const 2
      i32.shl
      local.tee $9
      i32.add
      i32.load
      local.get $3
      local.get $9
      i32.add
      i32.load
      i32.and
      i32.popcnt
      i32.add
      local.set $9
      local.get $8
      i32.const 1
      i32.add
      local.set $8
      br $for-loop|1
     end
    end
    local.get $4
    local.get $7
    i32.const 2
    i32.shl
    i32.add
    local.get $9
    i32.store
    local.get $7
    i32.const 1
    i32.add
    local.set $7
    br $for-loop|0
   end
  end
  loop $for-loop|2
   local.get $2
   local.get $10
   i32.gt_s
   if
    local.get $10
    i32.const 2
    i32.shl
    local.tee $0
    local.get $6
    i32.add
    local.get $0
    local.get $5
    i32.add
    i32.load
    local.get $0
    local.get $3
    i32.add
    i32.load
    i32.and
    i32.store
    local.get $10
    i32.const 1
    i32.add
    local.set $10
    br $for-loop|2
   end
  end
 )
 (func $wasm/assembly/territory/displace (param $0 i32)
  (local $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i32)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  (local $25 i32)
  (local $26 i32)
  (local $27 i32)
  (local $28 i32)
  (local $29 i32)
  (local $30 i32)
  (local $31 i32)
  (local $32 i32)
  (local $33 i32)
  local.get $0
  i32.load
  local.set $24
  local.get $0
  i32.load offset=16
  local.set $1
  local.get $0
  i32.load offset=20
  local.set $25
  local.get $0
  i32.load offset=24
  local.set $26
  local.get $0
  i32.load offset=28
  local.set $27
  local.get $0
  i32.load offset=32
  local.set $28
  local.get $0
  i32.load offset=36
  local.set $3
  local.get $0
  i32.load offset=40
  local.set $4
  local.get $0
  i32.load offset=44
  local.set $5
  local.get $0
  i32.load offset=48
  local.set $6
  local.get $0
  i32.load offset=52
  local.set $7
  local.get $0
  i32.load offset=56
  local.set $29
  local.get $0
  i32.load offset=60
  local.set $30
  local.get $0
  i32.const -64
  i32.sub
  i32.load
  local.tee $13
  local.get $0
  i32.load offset=8
  local.tee $14
  i32.const 2
  i32.shl
  local.tee $8
  i32.add
  local.tee $15
  local.get $8
  i32.add
  local.tee $16
  local.get $0
  i32.load offset=12
  local.tee $17
  i32.const 2
  i32.shl
  local.tee $8
  i32.add
  local.tee $18
  local.get $8
  i32.add
  local.set $19
  loop $for-loop|0
   local.get $2
   local.get $14
   i32.lt_s
   if
    local.get $6
    local.get $2
    i32.const 2
    i32.shl
    local.tee $8
    i32.add
    i32.load
    local.set $9
    local.get $8
    local.get $13
    i32.add
    local.get $4
    local.get $9
    i32.const 2
    i32.shl
    i32.add
    i32.load
    i32.store
    local.get $8
    local.get $15
    i32.add
    local.get $3
    local.get $1
    local.get $9
    i32.mul
    i32.const 2
    i32.shl
    i32.add
    i32.store
    local.get $2
    i32.const 1
    i32.add
    local.set $2
    br $for-loop|0
   end
  end
  i32.const 0
  local.set $2
  loop $for-loop|1
   local.get $2
   local.get $17
   i32.lt_s
   if
    local.get $7
    local.get $2
    i32.const 2
    i32.shl
    local.tee $6
    i32.add
    i32.load
    local.tee $8
    i32.const 2
    i32.shl
    local.set $9
    local.get $6
    local.get $16
    i32.add
    local.get $4
    local.get $9
    i32.add
    i32.load
    i32.store
    local.get $6
    local.get $18
    i32.add
    local.get $3
    local.get $1
    local.get $8
    i32.mul
    i32.const 2
    i32.shl
    i32.add
    i32.store
    local.get $6
    local.get $19
    i32.add
    local.get $5
    local.get $9
    i32.add
    i32.load
    i32.store
    local.get $2
    i32.const 1
    i32.add
    local.set $2
    br $for-loop|1
   end
  end
  loop $for-loop|2
   local.get $11
   local.get $24
   i32.lt_s
   if
    local.get $27
    local.get $11
    i32.const 2
    i32.shl
    local.tee $1
    i32.add
    i32.load
    local.tee $8
    if
     local.get $11
     i32.const 5
     i32.shl
     local.set $31
     local.get $1
     local.get $29
     i32.add
     i32.load
     local.set $32
     local.get $1
     local.get $30
     i32.add
     i32.load
     local.set $33
     loop $while-continue|3
      local.get $8
      if
       local.get $8
       local.get $8
       i32.const -1
       i32.xor
       i32.const 1
       i32.add
       i32.and
       local.set $20
       local.get $31
       local.get $8
       i32.ctz
       i32.add
       local.set $1
       local.get $8
       local.get $8
       i32.const 1
       i32.sub
       i32.and
       local.set $8
       local.get $28
       local.get $1
       i32.const 2
       i32.shl
       local.tee $21
       i32.add
       i32.load
       local.tee $22
       local.get $25
       i32.sub
       local.set $23
       i32.const -1
       local.set $1
       i32.const 0
       local.set $3
       loop $for-loop|4
        local.get $3
        local.get $14
        i32.lt_s
        if
         local.get $22
         local.get $3
         i32.const 2
         i32.shl
         local.tee $2
         local.get $13
         i32.add
         i32.load
         local.get $21
         i32.add
         i32.load
         i32.eq
         if
          local.get $2
          local.get $15
          i32.add
          i32.load
          local.get $23
          i32.const 2
          i32.shl
          i32.add
          i32.load
          local.tee $2
          local.get $1
          i32.gt_s
          if
           local.get $2
           local.set $1
          end
         end
         local.get $3
         i32.const 1
         i32.add
         local.set $3
         br $for-loop|4
        end
       end
       local.get $1
       i32.const 0
       i32.lt_s
       br_if $while-continue|3
       i32.const 2147483647
       local.set $6
       i32.const -1
       local.set $3
       i32.const -1
       local.set $4
       i32.const 0
       local.set $9
       i32.const 0
       local.set $2
       loop $for-loop|5
        local.get $2
        local.get $17
        i32.lt_s
        if
         block $for-continue|5
          local.get $22
          local.get $2
          i32.const 2
          i32.shl
          local.tee $5
          local.get $16
          i32.add
          i32.load
          local.get $21
          i32.add
          i32.load
          local.tee $7
          i32.lt_s
          br_if $for-continue|5
          local.get $1
          local.get $5
          local.get $18
          i32.add
          i32.load
          local.get $23
          i32.const 2
          i32.shl
          i32.add
          i32.load
          local.tee $5
          i32.ge_s
          br_if $for-continue|5
          local.get $3
          i32.const 0
          i32.lt_s
          local.get $6
          local.get $7
          i32.gt_s
          i32.or
          if (result i32)
           local.get $7
           local.set $6
           local.get $2
           local.set $3
           local.get $5
           local.set $4
           i32.const 0
          else
           local.get $6
           local.get $7
           i32.eq
           if (result i32)
            local.get $4
            local.get $5
            i32.lt_s
            if (result i32)
             local.get $2
             local.set $3
             local.get $5
             local.set $4
             i32.const 0
            else
             i32.const 1
             local.get $9
             local.get $4
             local.get $5
             i32.eq
             select
            end
           else
            local.get $9
           end
          end
          local.set $9
         end
         local.get $2
         i32.const 1
         i32.add
         local.set $2
         br $for-loop|5
        end
       end
       local.get $9
       i32.eqz
       local.get $3
       i32.const 0
       i32.ge_s
       i32.and
       if
        local.get $19
        local.get $3
        i32.const 2
        i32.shl
        i32.add
        i32.load
        local.get $26
        i32.eq
        if
         local.get $12
         i32.const 1
         i32.add
         local.set $12
        else
         local.get $10
         i32.const 1
         i32.add
         local.set $10
        end
        br $while-continue|3
       end
       local.get $20
       local.get $32
       i32.and
       if
        local.get $12
        i32.const 1
        i32.add
        local.set $12
       else
        local.get $10
        i32.const 1
        i32.add
        local.get $10
        local.get $20
        local.get $33
        i32.and
        select
        local.set $10
       end
       br $while-continue|3
      end
     end
    end
    local.get $11
    i32.const 1
    i32.add
    local.set $11
    br $for-loop|2
   end
  end
  local.get $0
  local.get $12
  i32.store offset=68
  local.get $0
  local.get $10
  i32.store offset=72
 )
 (func $wasm/assembly/territory/countSides (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  loop $for-loop|0
   local.get $3
   local.get $5
   i32.gt_s
   if
    local.get $8
    local.get $5
    i32.const 2
    i32.shl
    local.tee $6
    local.get $2
    i32.add
    i32.load
    local.tee $7
    local.get $0
    local.get $6
    i32.add
    i32.load
    i32.and
    i32.popcnt
    i32.add
    local.set $8
    local.get $9
    local.get $1
    local.get $6
    i32.add
    i32.load
    local.get $7
    i32.and
    i32.popcnt
    i32.add
    local.set $9
    local.get $5
    i32.const 1
    i32.add
    local.set $5
    br $for-loop|0
   end
  end
  local.get $4
  local.get $8
  i32.store
  local.get $4
  local.get $9
  i32.store offset=4
 )
)
